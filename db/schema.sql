-- Zipp File Hosting Database Schema

-- Files table stores all upload metadata
CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY,
    custom_hash TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    description TEXT,
    original_filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    storage_path TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NULL,
    download_count INTEGER NOT NULL DEFAULT 0,
    password_hash TEXT NULL
);

-- Index for faster hash lookups
CREATE INDEX IF NOT EXISTS idx_hash ON files(custom_hash);

-- Index for expiry queries
CREATE INDEX IF NOT EXISTS idx_expires ON files(expires_at);

-- API Keys table for developer access
CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    key_hash TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_used_at TEXT NULL,
    is_active INTEGER NOT NULL DEFAULT 1
);

-- Index for API key lookups
CREATE INDEX IF NOT EXISTS idx_api_key_hash ON api_keys(key_hash);
