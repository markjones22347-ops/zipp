/**
 * API Routes for Zipp file hosting service
 * Handles upload, download, and metadata retrieval
 */

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();

// Test route to verify routes are loading
router.get('/test', (req, res) => {
    res.json({ success: true, message: 'Routes are working' });
});

const {
    generateUniqueHash,
    validateSlug,
    calculateExpiry,
    createFileRecord,
    getFileByHash,
    incrementDownloadCount,
    isExpired,
    deleteFileRecord,
    getExpiredFiles,
    getAllFiles,
    formatFileSize,
    formatExpiry,
    hashPassword,
    verifyPassword
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
        
        const { display_name, description, expiry_option, custom_expiry, custom_slug, password } = req.body;
        
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
        
        // Hash password if provided
        let password_hash = null;
        if (password && password.trim().length > 0) {
            password_hash = hashPassword(password.trim());
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
            expires_at: expiresAt,
            password_hash: password_hash
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
    
    // Check password if required
    const providedPassword = req.query.password || req.body?.password;
    if (file.password_hash) {
        if (!providedPassword || !verifyPassword(providedPassword, file.password_hash)) {
            return res.status(401).send(generatePasswordPage(hash, file.display_name));
        }
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
    
    // Set appropriate headers - force download as attachment
    res.setHeader('Content-Type', file.mime_type);
    res.setHeader('Content-Disposition', `attachment; filename="${file.original_filename}"`);
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
 * Get download page (HTML) for a file - password protected
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
    
    // Check password FIRST before showing anything
    const providedPassword = req.query.password;
    if (file.password_hash) {
        if (!providedPassword || !verifyPassword(providedPassword, file.password_hash)) {
            return res.status(401).send(generatePasswordPage(hash, file.display_name));
        }
    }
    
    res.send(generateDownloadPage(file, providedPassword));
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
function generateDownloadPage(file, providedPassword) {
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

// API Keys for developers (in production, store hashed in DB)
const API_KEYS = new Set([
    'dev_' + ADMIN_TOKEN // Developer API key
]);

// Webhook URLs (configure these)
let webhookUrls = [];

// Admin token - hardcoded as requested
const ADMIN_TOKEN = 'tDhWn1TUA0E4DCgk0RbPQw';

/**
 * Admin authentication middleware
 */
function requireAdmin(req, res, next) {
    const token = req.query.token || req.headers['x-admin-token'];
    if (token !== ADMIN_TOKEN) {
        // Return HTML for browser access, JSON for API
        if (req.headers.accept && req.headers.accept.includes('text/html')) {
            return res.status(401).send(`<!DOCTYPE html>
<html><head><title>Unauthorized</title>
<style>
body { background: #0a0a0a; color: #e5e5e5; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; 
       display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
.container { background: #141414; border: 1px solid #262626; padding: 48px; text-align: center; }
h1 { font-size: 14px; text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 16px; }
p { color: #737373; font-size: 13px; }
</style></head>
<body><div class="container"><h1>401 Unauthorized</h1>
<p>Access denied. Add ?token= to URL.</p></div></body></html>`);
        }
        return res.status(401).json({ success: false, error: 'Unauthorized - add ?token= to URL' });
    }
    next();
}

/**
 * GET /admin
 * Admin dashboard HTML page
 */
router.get('/admin', requireAdmin, (req, res) => {
    res.send(generateAdminPage());
});

/**
 * GET /api/admin/files
 * Get all files for admin
 */
router.get('/admin/files', requireAdmin, (req, res) => {
    try {
        const files = getAllFiles();
        res.json({ success: true, files });
    } catch (error) {
        console.error('Admin files error:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch files' });
    }
});

/**
 * DELETE /api/admin/files/:hash
 * Delete a file as admin
 */
router.delete('/admin/files/:hash', requireAdmin, (req, res) => {
    try {
        const { hash } = req.params;
        const file = getFileByHash(hash);
        
        if (!file) {
            return res.status(404).json({ success: false, error: 'File not found' });
        }
        
        deleteFileRecord(hash);
        res.json({ success: true, message: 'File deleted' });
    } catch (error) {
        console.error('Admin delete error:', error);
        res.status(500).json({ success: false, error: 'Failed to delete file' });
    }
});

/**
 * POST /api/admin/cleanup
 * Bulk delete expired files
 */
router.post('/admin/cleanup', requireAdmin, (req, res) => {
    try {
        const expiredFiles = getExpiredFiles();
        let deletedCount = 0;
        
        for (const file of expiredFiles) {
            try {
                deleteFileRecord(file.custom_hash);
                deletedCount++;
            } catch (err) {
                console.error(`Failed to delete expired file ${file.custom_hash}:`, err);
            }
        }
        
        res.json({ 
            success: true, 
            message: `Deleted ${deletedCount} expired files`,
            deletedCount
        });
    } catch (error) {
        console.error('Admin cleanup error:', error);
        res.status(500).json({ success: false, error: 'Failed to cleanup files' });
    }
});

/**
 * API Key authentication middleware
 */
function requireApiKey(req, res, next) {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey || !API_KEYS.has(apiKey)) {
        return res.status(401).json({ success: false, error: 'Invalid API key' });
    }
    next();
}

/**
 * POST /api/v1/upload
 * Developer API endpoint for programmatic uploads
 */
router.post('/v1/upload', requireApiKey, upload.single('file'), handleMulterErrors, async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                error: 'No file provided'
            });
        }
        
        const { display_name, description, expiry_hours, custom_slug, password } = req.body;
        
        if (!display_name || display_name.trim().length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Display name is required'
            });
        }
        
        // Hash password if provided
        let password_hash = null;
        if (password && password.trim().length > 0) {
            password_hash = hashPassword(password.trim());
        }
        
        // Determine hash
        let hash;
        if (custom_slug && custom_slug.trim().length > 0) {
            const validation = validateSlug(custom_slug.trim());
            if (!validation.valid) {
                return res.status(400).json({ success: false, error: validation.message });
            }
            hash = custom_slug.trim();
        } else {
            hash = generateUniqueHash();
        }
        
        // Calculate expiry
        let expiresAt = null;
        if (expiry_hours && parseInt(expiry_hours) > 0) {
            const date = new Date();
            date.setHours(date.getHours() + parseInt(expiry_hours));
            expiresAt = date.toISOString();
        }
        
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
            expires_at: expiresAt,
            password_hash: password_hash
        };
        
        const file = createFileRecord(fileData);
        
        // Send webhook
        await sendWebhook('file.uploaded', {
            hash: file.custom_hash,
            display_name: file.display_name,
            size_bytes: file.size_bytes
        });
        
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
                url: `/d/${file.custom_hash}`,
                info_url: `/d/${file.custom_hash}/info`,
                download_url: `/d/${file.custom_hash}?download=1`,
                password_protected: !!file.password_hash
            }
        });
    } catch (error) {
        console.error('API upload error:', error);
        res.status(500).json({ success: false, error: 'Upload failed' });
    }
});

/**
 * GET /api/v1/files/:hash
 * Developer API - Get file metadata
 */
router.get('/v1/files/:hash', requireApiKey, (req, res) => {
    try {
        const { hash } = req.params;
        const file = getFileByHash(hash);
        
        if (!file) {
            return res.status(404).json({ success: false, error: 'File not found' });
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
                download_count: file.download_count,
                is_expired: isExpired(file),
                password_protected: !!file.password_hash
            }
        });
    } catch (error) {
        console.error('API file fetch error:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch file' });
    }
});

/**
 * POST /api/v1/webhooks/configure
 * Configure webhook URLs (admin only)
 */
router.post('/v1/webhooks/configure', requireAdmin, (req, res) => {
    const { urls } = req.body;
    if (!Array.isArray(urls)) {
        return res.status(400).json({ success: false, error: 'urls must be an array' });
    }
    
    // Validate URLs
    const validUrls = urls.filter(url => {
        try {
            new URL(url);
            return true;
        } catch {
            return false;
        }
    });
    
    webhookUrls = validUrls;
    
    res.json({
        success: true,
        message: `Configured ${webhookUrls.length} webhook(s)`,
        urls: webhookUrls
    });
});

/**
 * Send webhook notification using https module
 */
function sendWebhook(event, data) {
    if (webhookUrls.length === 0) return;
    
    const payload = JSON.stringify({
        event,
        timestamp: new Date().toISOString(),
        data
    });
    
    for (const urlString of webhookUrls) {
        try {
            const url = new URL(urlString);
            const options = {
                hostname: url.hostname,
                port: url.port || (url.protocol === 'https:' ? 443 : 80),
                path: url.pathname + url.search,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(payload)
                }
            };
            
            const protocol = url.protocol === 'https:' ? https : require('http');
            const req = protocol.request(options, (res) => {
                if (res.statusCode < 200 || res.statusCode >= 300) {
                    console.error(`Webhook failed for ${urlString}:`, res.statusCode);
                }
            });
            
            req.on('error', (error) => {
                console.error(`Webhook error for ${urlString}:`, error.message);
            });
            
            req.write(payload);
            req.end();
        } catch (error) {
            console.error(`Webhook error for ${urlString}:`, error.message);
        }
    }
}

/**
 * Generate HTML for admin dashboard
 */
function generateAdminPage() {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Admin Dashboard - zipp</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            background: #0a0a0a;
            color: #e5e5e5;
            font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
            min-height: 100vh;
            padding: 40px 20px;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
        }
        h1 {
            font-size: 20px;
            margin-bottom: 8px;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }
        .subtitle {
            color: #737373;
            font-size: 12px;
            margin-bottom: 32px;
        }
        .stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 16px;
            margin-bottom: 32px;
        }
        .stat-card {
            background: #141414;
            border: 1px solid #262626;
            padding: 20px;
        }
        .stat-value {
            font-size: 28px;
            color: #fff;
            margin-bottom: 4px;
        }
        .stat-label {
            font-size: 11px;
            color: #737373;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }
        .actions {
            margin-bottom: 24px;
        }
        .btn {
            background: #262626;
            border: 1px solid #404040;
            color: #e5e5e5;
            padding: 10px 20px;
            font-family: inherit;
            font-size: 12px;
            cursor: pointer;
            margin-right: 8px;
            text-transform: uppercase;
        }
        .btn:hover { background: #404040; }
        .btn.danger { background: #dc2626; border-color: #dc2626; }
        .btn.danger:hover { background: #ef4444; }
        .files-table {
            width: 100%;
            border-collapse: collapse;
            background: #141414;
            border: 1px solid #262626;
        }
        .files-table th {
            text-align: left;
            padding: 12px;
            font-size: 11px;
            color: #737373;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            border-bottom: 1px solid #262626;
        }
        .files-table td {
            padding: 12px;
            font-size: 12px;
            border-bottom: 1px solid #262626;
        }
        .files-table tr:hover { background: #1a1a1a; }
        .expired { color: #dc2626; }
        .protected { color: #f59e0b; }
        .delete-btn {
            background: #dc2626;
            border: none;
            color: white;
            padding: 4px 12px;
            font-size: 11px;
            cursor: pointer;
            text-transform: uppercase;
        }
        .delete-btn:hover { background: #ef4444; }
        .file-link { color: #e5e5e5; text-decoration: none; }
        .file-link:hover { color: #fff; text-decoration: underline; }
        .loading { color: #737373; }
        .empty { padding: 40px; text-align: center; color: #737373; }
    </style>
</head>
<body>
    <div class="container">
        <h1>Admin Dashboard</h1>
        <p class="subtitle">zipp file hosting management</p>
        
        <div class="stats">
            <div class="stat-card">
                <div class="stat-value" id="totalFiles">-</div>
                <div class="stat-label">Total Files</div>
            </div>
            <div class="stat-card">
                <div class="stat-value" id="totalSize">-</div>
                <div class="stat-label">Total Size</div>
            </div>
            <div class="stat-card">
                <div class="stat-value" id="expiredFiles">-</div>
                <div class="stat-label">Expired Files</div>
            </div>
            <div class="stat-card">
                <div class="stat-value" id="passwordProtected">-</div>
                <div class="stat-label">Password Protected</div>
            </div>
        </div>
        
        <div class="actions">
            <button class="btn" onclick="refreshFiles()">Refresh</button>
            <button class="btn danger" onclick="cleanupExpired()">Delete Expired Files</button>
        </div>
        
        <div id="filesContainer">
            <div class="loading">Loading files...</div>
        </div>
    </div>
    
    <script>
        const urlParams = new URLSearchParams(window.location.search);
        const token = urlParams.get('token');
        
        async function fetchFiles() {
            const res = await fetch('/api/admin/files?token=' + token);
            const data = await res.json();
            if (!data.success) throw new Error(data.error);
            return data.files;
        }
        
        async function refreshFiles() {
            document.getElementById('filesContainer').innerHTML = '<div class="loading">Loading files...</div>';
            try {
                const files = await fetchFiles();
                renderFiles(files);
                updateStats(files);
            } catch (err) {
                document.getElementById('filesContainer').innerHTML = '<div class="empty">Error: ' + err.message + '</div>';
            }
        }
        
        async function deleteFile(hash) {
            if (!confirm('Delete this file?')) return;
            try {
                const res = await fetch('/api/admin/files/' + hash + '?token=' + token, { method: 'DELETE' });
                const data = await res.json();
                if (!data.success) throw new Error(data.error);
                refreshFiles();
            } catch (err) {
                alert('Error: ' + err.message);
            }
        }
        
        async function cleanupExpired() {
            if (!confirm('Delete ALL expired files? This cannot be undone.')) return;
            try {
                const res = await fetch('/api/admin/cleanup?token=' + token, { method: 'POST' });
                const data = await res.json();
                if (!data.success) throw new Error(data.error);
                alert('Deleted ' + data.deletedCount + ' expired files');
                refreshFiles();
            } catch (err) {
                alert('Error: ' + err.message);
            }
        }
        
        function updateStats(files) {
            const total = files.length;
            const totalBytes = files.reduce((sum, f) => sum + f.size_bytes, 0);
            const expired = files.filter(f => f.expires_at && new Date(f.expires_at) < new Date()).length;
            const protected = files.filter(f => f.password_hash).length;
            
            document.getElementById('totalFiles').textContent = total;
            document.getElementById('totalSize').textContent = formatBytes(totalBytes);
            document.getElementById('expiredFiles').textContent = expired;
            document.getElementById('passwordProtected').textContent = protected;
        }
        
        function formatBytes(bytes) {
            if (bytes === 0) return '0 B';
            const k = 1024;
            const sizes = ['B', 'KB', 'MB', 'GB'];
            const i = Math.floor(Math.log(bytes) / Math.log(k));
            return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
        }
        
        function renderFiles(files) {
            if (files.length === 0) {
                document.getElementById('filesContainer').innerHTML = '<div class="empty">No files yet.</div>';
                return;
            }
            
            const html = '<table class="files-table"><thead><tr><th>Name</th><th>Hash</th><th>Size</th><th>Created</th><th>Expires</th><th>Downloads</th><th>Protected</th><th>Action</th></tr></thead><tbody>' +
                files.map(f => {
                    const isExpired = f.expires_at && new Date(f.expires_at) < new Date();
                    return '<tr>' +
                        '<td><a class="file-link" href="/d/' + f.custom_hash + '/info?token=' + token + '" target="_blank">' + escapeHtml(f.display_name) + '</a></td>' +
                        '<td>' + f.custom_hash + '</td>' +
                        '<td>' + formatBytes(f.size_bytes) + '</td>' +
                        '<td>' + new Date(f.created_at).toLocaleDateString() + '</td>' +
                        '<td class="' + (isExpired ? 'expired' : '') + '">' + (f.expires_at ? new Date(f.expires_at).toLocaleDateString() : 'Never') + '</td>' +
                        '<td>' + f.download_count + '</td>' +
                        '<td class="' + (f.password_hash ? 'protected' : '') + '">' + (f.password_hash ? 'Yes' : 'No') + '</td>' +
                        '<td><button class="delete-btn" onclick="deleteFile(\'' + f.custom_hash + '\')">Delete</button></td>' +
                    '</tr>';
                }).join('') +
                '</tbody></table>';
            
            document.getElementById('filesContainer').innerHTML = html;
        }
        
        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
        
        // Load on page load
        refreshFiles();
    </script>
</body>
</html>`;
}

module.exports = router;
