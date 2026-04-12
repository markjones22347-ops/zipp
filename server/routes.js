/**
 * API Routes for Zipp file hosting service
 * Handles upload, download, and metadata retrieval
 */

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();

const {
    generateUniqueHash,
    validateSlug,
    calculateExpiry,
    createFileRecord,
    getFileByHash,
    incrementDownloadCount,
    isExpired,
    formatFileSize
} = require('./db');

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer storage
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        // Create a unique folder for each upload
        const uploadId = uuidv4();
        const uploadPath = path.join(uploadsDir, uploadId);
        fs.mkdirSync(uploadPath, { recursive: true });
        
        // Store the upload ID on the request for later use
        req.uploadId = uploadId;
        req.uploadPath = uploadPath;
        
        cb(null, uploadPath);
    },
    filename: (req, file, cb) => {
        // Use original filename but sanitize it
        const sanitized = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
        cb(null, sanitized);
    }
});

// Configure multer with file size limit (100MB)
const upload = multer({
    storage: storage,
    limits: {
        fileSize: 100 * 1024 * 1024 // 100MB
    }
});

/**
 * Multer error handling wrapper
 */
function handleMulterErrors(err, req, res, next) {
    if (err instanceof multer.MulterError) {
        // Clean up any created directory
        if (req.uploadPath && fs.existsSync(req.uploadPath)) {
            fs.rmSync(req.uploadPath, { recursive: true, force: true });
        }
        
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({
                success: false,
                error: 'File too large. Maximum size is 100MB.'
            });
        }
        return res.status(400).json({
            success: false,
            error: 'Upload error: ' + err.message
        });
    } else if (err) {
        // Clean up any created directory
        if (req.uploadPath && fs.existsSync(req.uploadPath)) {
            fs.rmSync(req.uploadPath, { recursive: true, force: true });
        }
        return res.status(500).json({
            success: false,
            error: 'Server error during upload'
        });
    }
    next();
}

/**
 * POST /api/upload
 * Handle file uploads with metadata
 */
router.post('/upload', (req, res, next) => {
    upload.single('file')(req, res, (err) => {
        if (err) {
            return handleMulterErrors(err, req, res, next);
        }
        next();
    });
}, (req, res) => {
    try {
        // Validate file was uploaded
        if (!req.file) {
            // Clean up any created directory
            if (req.uploadPath && fs.existsSync(req.uploadPath)) {
                fs.rmSync(req.uploadPath, { recursive: true, force: true });
            }
            return res.status(400).json({
                success: false,
                error: 'No file provided'
            });
        }
        
        const { display_name, description, expiry_option, custom_expiry, custom_slug } = req.body;
        
        // Validate required fields
        if (!display_name || display_name.trim().length === 0) {
            // Clean up uploaded file
            if (req.uploadPath && fs.existsSync(req.uploadPath)) {
                fs.rmSync(req.uploadPath, { recursive: true, force: true });
            }
            return res.status(400).json({
                success: false,
                error: 'Display name is required'
            });
        }
        
        // Determine the hash to use
        let hash;
        if (custom_slug && custom_slug.trim().length > 0) {
            const validation = validateSlug(custom_slug.trim());
            if (!validation.valid) {
                // Clean up uploaded file
                if (req.uploadPath && fs.existsSync(req.uploadPath)) {
                    fs.rmSync(req.uploadPath, { recursive: true, force: true });
                }
                return res.status(400).json({
                    success: false,
                    error: validation.error
                });
            }
            hash = custom_slug.trim();
        } else {
            hash = generateUniqueHash();
        }
        
        // Calculate expiry
        const expiresAt = calculateExpiry(expiry_option, custom_expiry);
        
        // Create file record
        const fileData = {
            id: uuidv4(),
            custom_hash: hash,
            display_name: display_name.trim(),
            description: description ? description.trim() : null,
            original_filename: req.file.originalname,
            mime_type: req.file.mimetype,
            size_bytes: req.file.size,
            storage_path: req.uploadPath,
            created_at: new Date().toISOString(),
            expires_at: expiresAt
        };
        
        const record = createFileRecord(fileData);
        
        res.json({
            success: true,
            url: `/d/${hash}`,
            file: {
                id: record.id,
                custom_hash: record.custom_hash,
                display_name: record.display_name,
                description: record.description,
                original_filename: record.original_filename,
                mime_type: record.mime_type,
                size_bytes: record.size_bytes,
                size_formatted: formatFileSize(record.size_bytes),
                created_at: record.created_at,
                expires_at: record.expires_at,
                download_count: record.download_count
            }
        });
        
    } catch (error) {
        console.error('Upload error:', error);
        
        // Clean up on error
        if (req.uploadPath && fs.existsSync(req.uploadPath)) {
            fs.rmSync(req.uploadPath, { recursive: true, force: true });
        }
        
        res.status(500).json({
            success: false,
            error: 'Upload failed: ' + error.message
        });
    }
});

/**
 * GET /api/file/:hash
 * Get file metadata without downloading
 */
router.get('/file/:hash', (req, res) => {
    const { hash } = req.params;
    const file = getFileByHash(hash);
    
    if (!file) {
        return res.status(404).json({
            success: false,
            error: 'File not found'
        });
    }
    
    if (isExpired(file)) {
        return res.status(410).json({
            success: false,
            error: 'File has expired',
            expired: true
        });
    }
    
    res.json({
        success: true,
        file: {
            id: file.id,
            custom_hash: file.custom_hash,
            display_name: file.display_name,
            description: file.description,
            original_filename: file.original_filename,
            mime_type: file.mime_type,
            size_bytes: file.size_bytes,
            size_formatted: formatFileSize(file.size_bytes),
            created_at: file.created_at,
            expires_at: file.expires_at,
            download_count: file.download_count
        }
    });
});

/**
 * GET /d/:hash
 * Download file by hash (HTML page or direct download)
 */
router.get('/d/:hash', (req, res) => {
    const { hash } = req.params;
    const file = getFileByHash(hash);
    
    // File not found
    if (!file) {
        return res.status(404).send(generateNotFoundPage(hash));
    }
    
    // File expired
    if (isExpired(file)) {
        return res.status(410).send(generateExpiredPage(file));
    }
    
    // Get the actual file from storage directory
    const filesInDir = fs.readdirSync(file.storage_path);
    const actualFile = filesInDir.find(f => f === file.original_filename);
    
    if (!actualFile) {
        return res.status(404).send(generateNotFoundPage(hash));
    }
    
    const filePath = path.join(file.storage_path, actualFile);
    
    // Increment download count
    incrementDownloadCount(file.id);
    
    // Set appropriate headers
    res.setHeader('Content-Type', file.mime_type);
    res.setHeader('Content-Disposition', `inline; filename="${file.original_filename}"`);
    res.setHeader('Content-Length', file.size_bytes);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    
    // Stream the file
    const fileStream = fs.createReadStream(filePath);
    fileStream.on('error', (err) => {
        console.error('Error streaming file:', err);
        res.status(500).send('Error downloading file');
    });
    
    fileStream.pipe(res);
});

/**
 * GET /d/:hash/info
 * Get download page (HTML) for a file
 */
router.get('/d/:hash/info', (req, res) => {
    const { hash } = req.params;
    const file = getFileByHash(hash);
    
    if (!file) {
        return res.status(404).send(generateNotFoundPage(hash));
    }
    
    if (isExpired(file)) {
        return res.status(410).send(generateExpiredPage(file));
    }
    
    res.send(generateDownloadPage(file));
});

/**
 * Generate HTML for file not found
 */
function generateNotFoundPage(hash) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Not Found - Zipp</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            background: #0a0a0a;
            color: #e5e5e5;
            font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
            padding: 20px;
        }
        .container {
            background: #141414;
            border: 1px solid #262626;
            padding: 48px;
            max-width: 400px;
            width: 100%;
        }
        .icon { font-size: 32px; margin-bottom: 16px; }
        h1 {
            font-size: 14px;
            font-weight: 500;
            color: #fff;
            margin-bottom: 8px;
            text-transform: uppercase;
            letter-spacing: 0.1em;
        }
        p {
            font-size: 13px;
            color: #737373;
            line-height: 1.6;
            margin-bottom: 24px;
        }
        .hash {
            font-family: ui-monospace, SFMono-Regular, monospace;
            background: #0a0a0a;
            border: 1px solid #262626;
            padding: 8px 12px;
            font-size: 12px;
            color: #525252;
            margin-bottom: 24px;
            display: inline-block;
        }
        a {
            display: inline-block;
            background: #e5e5e5;
            color: #0a0a0a;
            padding: 10px 20px;
            font-size: 12px;
            text-decoration: none;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            font-weight: 500;
        }
        a:hover { background: #fff; }
    </style>
</head>
<body>
    <div class="container">
        <div class="icon">/</div>
        <h1>404 Not Found</h1>
        <p>File not found. It may have been deleted or expired.</p>
        <div class="hash">${hash}</div>
        <br>
        <a href="/">Upload File</a>
    </div>
</body>
</html>`;
}

/**
 * Generate HTML for expired file
 */
function generateExpiredPage(file) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Expired - Zipp</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            background: #0a0a0a;
            color: #e5e5e5;
            font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
            padding: 20px;
        }
        .container {
            background: #141414;
            border: 1px solid #262626;
            padding: 48px;
            max-width: 400px;
            width: 100%;
        }
        .icon { font-size: 32px; margin-bottom: 16px; }
        h1 {
            font-size: 14px;
            font-weight: 500;
            color: #fff;
            margin-bottom: 8px;
            text-transform: uppercase;
            letter-spacing: 0.1em;
        }
        .file-box {
            background: #0a0a0a;
            border: 1px solid #262626;
            padding: 16px;
            margin: 24px 0;
        }
        .file-name {
            font-size: 13px;
            color: #fff;
            margin-bottom: 4px;
        }
        .file-meta {
            font-size: 12px;
            color: #dc2626;
        }
        p {
            font-size: 13px;
            color: #737373;
            line-height: 1.6;
        }
        a {
            display: inline-block;
            background: #e5e5e5;
            color: #0a0a0a;
            padding: 10px 20px;
            font-size: 12px;
            text-decoration: none;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            font-weight: 500;
        }
        a:hover { background: #fff; }
    </style>
</head>
<body>
    <div class="container">
        <div class="icon">!</div>
        <h1>File Expired</h1>
        <div class="file-box">
            <div class="file-name">${file.display_name}</div>
            <div class="file-meta">Expired ${new Date(file.expires_at).toLocaleDateString()}</div>
        </div>
        <p>This file is no longer available.</p>
        <br>
        <a href="/">Upload File</a>
    </div>
</body>
</html>`;
}

/**
 * Generate HTML download page for a file
 */
function generateDownloadPage(file) {
    const sizeFormatted = formatFileSize(file.size_bytes);
    const expiryText = file.expires_at 
        ? `Expires ${new Date(file.expires_at).toLocaleDateString()}`
        : 'Never expires';
    
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${file.display_name} - Zipp</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            background: #0a0a0a;
            color: #e5e5e5;
            font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
            padding: 20px;
        }
        .container {
            background: #141414;
            border: 1px solid #262626;
            padding: 48px;
            max-width: 420px;
            width: 100%;
        }
        .file-icon { font-size: 24px; margin-bottom: 24px; }
        .file-name {
            font-size: 15px;
            color: #fff;
            margin-bottom: 4px;
            word-break: break-word;
            font-weight: 500;
        }
        .file-meta {
            color: #737373;
            font-size: 12px;
            margin-bottom: 24px;
        }
        .file-description {
            color: #a3a3a3;
            font-size: 13px;
            margin-bottom: 24px;
            line-height: 1.5;
            padding: 16px;
            background: #0a0a0a;
            border: 1px solid #262626;
        }
        .download-btn {
            display: block;
            background: #e5e5e5;
            color: #0a0a0a;
            padding: 12px 24px;
            text-decoration: none;
            font-size: 12px;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            font-weight: 500;
            text-align: center;
            border: none;
            cursor: pointer;
            width: 100%;
        }
        .download-btn:hover { background: #fff; }
        .file-stats {
            margin-top: 24px;
            padding-top: 24px;
            border-top: 1px solid #262626;
            font-size: 12px;
            color: #525252;
        }
        .brand {
            margin-top: 24px;
            font-size: 11px;
            color: #404040;
        }
        .brand a {
            color: #737373;
            text-decoration: none;
        }
        .brand a:hover { color: #a3a3a3; }
    </style>
</head>
<body>
    <div class="container">
        <div class="file-icon">◉</div>
        <div class="file-name">${file.display_name}</div>
        <div class="file-meta">${file.original_filename} · ${sizeFormatted}</div>
        ${file.description ? `<div class="file-description">${file.description}</div>` : ''}
        <a href="/d/${file.custom_hash}?download=1" class="download-btn">Download</a>
        <div class="file-stats">
            ↓ ${file.download_count} · ${expiryText}
        </div>
        <div class="brand">
            <a href="/">zipp</a>
        </div>
    </div>
</body>
</html>`;
}

module.exports = router;
