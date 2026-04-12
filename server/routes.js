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
    <title>File Not Found - Zipp</title>
    <link rel="stylesheet" href="/styles.css">
    <style>
        body {
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            margin: 0;
        }
        .error-container {
            background: white;
            border-radius: 18px;
            padding: 60px;
            text-align: center;
            box-shadow: 0 20px 60px rgba(0,0,0,0.2);
            max-width: 500px;
            animation: fadeInUp 0.6s ease-out;
        }
        .error-icon {
            font-size: 80px;
            margin-bottom: 20px;
        }
        .error-title {
            font-size: 32px;
            color: #333;
            margin-bottom: 15px;
            font-weight: 700;
        }
        .error-message {
            color: #666;
            font-size: 16px;
            margin-bottom: 30px;
            line-height: 1.6;
        }
        .error-hash {
            font-family: monospace;
            background: #f3f4f6;
            padding: 8px 16px;
            border-radius: 8px;
            color: #999;
            font-size: 14px;
        }
        .btn-home {
            display: inline-block;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 14px 32px;
            border-radius: 12px;
            text-decoration: none;
            font-weight: 600;
            transition: transform 0.2s, box-shadow 0.2s;
        }
        .btn-home:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 20px rgba(102, 126, 234, 0.4);
        }
        @keyframes fadeInUp {
            from { opacity: 0; transform: translateY(30px); }
            to { opacity: 1; transform: translateY(0); }
        }
    </style>
</head>
<body>
    <div class="error-container">
        <div class="error-icon">🔍</div>
        <h1 class="error-title">File Not Found</h1>
        <p class="error-message">
            We couldn't find a file with the requested identifier.<br>
            It may have been deleted or the link might be incorrect.
        </p>
        <p class="error-hash">${hash}</p>
        <br><br>
        <a href="/" class="btn-home">Upload a File</a>
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
    <title>File Expired - Zipp</title>
    <link rel="stylesheet" href="/styles.css">
    <style>
        body {
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
            margin: 0;
        }
        .error-container {
            background: white;
            border-radius: 18px;
            padding: 60px;
            text-align: center;
            box-shadow: 0 20px 60px rgba(0,0,0,0.2);
            max-width: 500px;
            animation: fadeInUp 0.6s ease-out;
        }
        .error-icon {
            font-size: 80px;
            margin-bottom: 20px;
        }
        .error-title {
            font-size: 32px;
            color: #333;
            margin-bottom: 15px;
            font-weight: 700;
        }
        .error-message {
            color: #666;
            font-size: 16px;
            margin-bottom: 30px;
            line-height: 1.6;
        }
        .file-info {
            background: #f3f4f6;
            padding: 20px;
            border-radius: 12px;
            margin-bottom: 25px;
        }
        .file-name {
            font-weight: 600;
            color: #333;
            margin-bottom: 5px;
        }
        .file-expired {
            color: #f5576c;
            font-size: 14px;
        }
        .btn-home {
            display: inline-block;
            background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
            color: white;
            padding: 14px 32px;
            border-radius: 12px;
            text-decoration: none;
            font-weight: 600;
            transition: transform 0.2s, box-shadow 0.2s;
        }
        .btn-home:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 20px rgba(245, 87, 108, 0.4);
        }
        @keyframes fadeInUp {
            from { opacity: 0; transform: translateY(30px); }
            to { opacity: 1; transform: translateY(0); }
        }
    </style>
</head>
<body>
    <div class="error-container">
        <div class="error-icon">⏰</div>
        <h1 class="error-title">File Expired</h1>
        <p class="error-message">
            This file has passed its expiration date and is no longer available for download.
        </p>
        <div class="file-info">
            <div class="file-name">${file.display_name}</div>
            <div class="file-expired">Expired on ${new Date(file.expires_at).toLocaleString()}</div>
        </div>
        <a href="/" class="btn-home">Upload a File</a>
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
        ? `Expires: ${new Date(file.expires_at).toLocaleString()}`
        : 'Never expires';
    
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${file.display_name} - Zipp</title>
    <link rel="stylesheet" href="/styles.css">
    <style>
        body {
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            margin: 0;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
        }
        .download-container {
            background: white;
            border-radius: 18px;
            padding: 50px;
            text-align: center;
            box-shadow: 0 20px 60px rgba(0,0,0,0.2);
            max-width: 500px;
            width: 90%;
            animation: fadeInUp 0.6s ease-out;
        }
        .file-icon {
            font-size: 64px;
            margin-bottom: 20px;
        }
        .file-name {
            font-size: 24px;
            color: #333;
            margin-bottom: 10px;
            font-weight: 700;
            word-break: break-word;
        }
        .file-meta {
            color: #666;
            font-size: 14px;
            margin-bottom: 25px;
        }
        .file-description {
            color: #555;
            font-size: 15px;
            margin-bottom: 25px;
            line-height: 1.5;
            padding: 15px;
            background: #f8f9fa;
            border-radius: 10px;
        }
        .download-btn {
            display: inline-flex;
            align-items: center;
            gap: 10px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 16px 40px;
            border-radius: 12px;
            text-decoration: none;
            font-weight: 600;
            font-size: 16px;
            border: none;
            cursor: pointer;
            transition: transform 0.2s, box-shadow 0.2s;
        }
        .download-btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 25px rgba(102, 126, 234, 0.5);
        }
        .download-count {
            margin-top: 20px;
            color: #999;
            font-size: 13px;
        }
        .brand {
            margin-top: 30px;
            padding-top: 20px;
            border-top: 1px solid #eee;
        }
        .brand a {
            color: #667eea;
            text-decoration: none;
            font-weight: 600;
        }
        @keyframes fadeInUp {
            from { opacity: 0; transform: translateY(30px); }
            to { opacity: 1; transform: translateY(0); }
        }
    </style>
</head>
<body>
    <div class="download-container">
        <div class="file-icon">📦</div>
        <h1 class="file-name">${file.display_name}</h1>
        <div class="file-meta">${sizeFormatted} • ${file.original_filename}</div>
        ${file.description ? `<div class="file-description">${file.description}</div>` : ''}
        <a href="/d/${file.custom_hash}?download=1" class="download-btn">
            <span>⬇️</span>
            <span>Download File</span>
        </a>
        <div class="download-count">
            Downloaded ${file.download_count} time${file.download_count !== 1 ? 's' : ''} • ${expiryText}
        </div>
        <div class="brand">
            <a href="/">Zipp</a> — Simple file sharing
        </div>
    </div>
</body>
</html>`;
}

module.exports = router;
