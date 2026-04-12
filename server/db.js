/**
 * Database module for Zipp file hosting service
 * Uses better-sqlite3 for synchronous, high-performance SQLite operations
 */

const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', 'db', 'zipp.db');
const SCHEMA_PATH = path.join(__dirname, '..', 'db', 'schema.sql');

let db = null;
let dbError = null;

/**
 * Initialize database with error handling
 */
function initDatabase() {
    if (db) return db;
    if (dbError) throw dbError;
    
    try {
        const Database = require('better-sqlite3');
        
        // Ensure db directory exists
        const dbDir = path.dirname(DB_PATH);
        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir, { recursive: true });
        }
        
        // Initialize database connection
        db = new Database(DB_PATH);
        
        // Enable WAL mode for better performance
        db.pragma('journal_mode = WAL');
        
        // Execute schema on startup
        const schema = fs.readFileSync(SCHEMA_PATH, 'utf-8');
        db.exec(schema);
        
        console.log('Database initialized successfully at:', DB_PATH);
        return db;
    } catch (error) {
        dbError = error;
        console.error('Database initialization failed:', error.message);
        throw error;
    }
}

// Initialize on module load
try {
    initDatabase();
} catch (error) {
    console.error('Warning: Database not available, some features may not work');
}

/**
 * Generate a random hash for file identification
 * Creates an 8-12 character alphanumeric string
 */
function generateHash(length = 10) {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

/**
 * Generate a unique hash that doesn't exist in the database
 */
function generateUniqueHash() {
    initDatabase(); // Ensure db is ready
    
    let hash;
    let attempts = 0;
    const maxAttempts = 100;
    
    do {
        // Vary length between 8-12 characters
        const length = Math.floor(Math.random() * 5) + 8;
        hash = generateHash(length);
        attempts++;
        
        // Check if hash exists
        const existing = db.prepare('SELECT 1 FROM files WHERE custom_hash = ?').get(hash);
        if (!existing) {
            return hash;
        }
    } while (attempts < maxAttempts);
    
    // Fallback: use timestamp + random
    return generateHash(12) + Date.now().toString(36);
}

/**
 * Validate a custom slug/hash
 * Allowed: letters, numbers, dashes, underscores
 * Length: 3-50 characters
 */
function validateSlug(slug) {
    if (!slug || typeof slug !== 'string') {
        return { valid: false, error: 'Slug is required' };
    }
    
    if (slug.length < 3 || slug.length > 50) {
        return { valid: false, error: 'Slug must be between 3 and 50 characters' };
    }
    
    if (!/^[a-zA-Z0-9_-]+$/.test(slug)) {
        return { valid: false, error: 'Slug can only contain letters, numbers, dashes, and underscores' };
    }
    
    // Check if slug already exists
    try {
        initDatabase(); // Ensure db is ready
        const existing = db.prepare('SELECT 1 FROM files WHERE custom_hash = ?').get(slug);
        if (existing) {
            return { valid: false, error: 'This slug is already in use' };
        }
    } catch (error) {
        // If db is not available, skip duplicate check
    }
    
    return { valid: true };
}

/**
 * Calculate expiry date based on selected option
 */
function calculateExpiry(expiryOption, customExpiry) {
    const now = new Date();
    
    switch (expiryOption) {
        case 'one_day':
            return new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
        case 'one_week':
            return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
        case 'one_month':
            return new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
        case 'never':
            return null;
        case 'custom':
            if (!customExpiry) {
                return null;
            }
            return new Date(customExpiry).toISOString();
        default:
            return new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
    }
}

/**
 * Hash password using bcrypt
 */
function hashPassword(password) {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(password).digest('hex');
}

/**
 * Verify password against hash
 */
function verifyPassword(password, hash) {
    const crypto = require('crypto');
    const hashed = crypto.createHash('sha256').update(password).digest('hex');
    return hashed === hash;
}

/**
 * Create a new file record in the database
 */
function createFileRecord(data) {
    initDatabase(); // Ensure db is ready
    
    const {
        id,
        custom_hash,
        display_name,
        description,
        original_filename,
        mime_type,
        size_bytes,
        storage_path,
        created_at,
        expires_at,
        password_hash
    } = data;
    
    const stmt = db.prepare(`
        INSERT INTO files (
            id, custom_hash, display_name, description, original_filename,
            mime_type, size_bytes, storage_path, created_at, expires_at, download_count, password_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
    `);
    
    stmt.run(
        id,
        custom_hash,
        display_name,
        description || null,
        original_filename,
        mime_type,
        size_bytes,
        storage_path,
        created_at,
        expires_at,
        password_hash || null
    );
    
    return getFileByHash(custom_hash);
}

/**
 * Get file record by hash
 */
function getFileByHash(hash) {
    initDatabase(); // Ensure db is ready
    return db.prepare('SELECT * FROM files WHERE custom_hash = ?').get(hash);
}

/**
 * Increment download count for a file
 */
function incrementDownloadCount(id) {
    initDatabase(); // Ensure db is ready
    const stmt = db.prepare('UPDATE files SET download_count = download_count + 1 WHERE id = ?');
    stmt.run(id);
}

/**
 * Check if a file has expired
 */
function isExpired(file) {
    if (!file.expires_at) {
        return false;
    }
    return new Date(file.expires_at) < new Date();
}

/**
 * Delete a file record from the database
 */
function deleteFileRecord(id) {
    initDatabase(); // Ensure db is ready
    const stmt = db.prepare('DELETE FROM files WHERE id = ?');
    return stmt.run(id);
}

/**
 * Get all expired files
 */
function getExpiredFiles() {
    initDatabase(); // Ensure db is ready
    return db.prepare(`
        SELECT * FROM files 
        WHERE expires_at IS NOT NULL 
        AND expires_at < datetime('now')
    `).all();
}

/**
 * Get all files (for admin/cleanup purposes)
 */
function getAllFiles() {
    initDatabase(); // Ensure db is ready
    return db.prepare('SELECT * FROM files ORDER BY created_at DESC').all();
}

/**
 * Format file size for display
 */
function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Format expiry for display
 */
function formatExpiry(expiresAt) {
    if (!expiresAt) {
        return 'Never';
    }
    const date = new Date(expiresAt);
    const now = new Date();
    const diffMs = date - now;
    
    if (diffMs < 0) {
        return 'Expired';
    }
    
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const diffHours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    
    if (diffDays > 0) {
        return `${diffDays} day${diffDays > 1 ? 's' : ''} left`;
    } else if (diffHours > 0) {
        return `${diffHours} hour${diffHours > 1 ? 's' : ''} left`;
    } else {
        return 'Less than an hour left';
    }
}

module.exports = {
    initDatabase,
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
};
