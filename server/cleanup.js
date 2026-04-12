/**
 * Cleanup script for Zipp file hosting service
 * Deletes expired files from storage and database
 * 
 * Usage:
 *   node cleanup.js           - Run cleanup once
 *   node cleanup.js --dry-run - Show what would be deleted without deleting
 *   node cleanup.js --daemon  - Run continuously with interval
 */

const fs = require('fs');
const path = require('path');
const { getExpiredFiles, deleteFileRecord, db } = require('./db');

const DRY_RUN = process.argv.includes('--dry-run');
const DAEMON = process.argv.includes('--daemon');
const INTERVAL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Delete a file and its storage directory
 */
function deleteFileStorage(storagePath) {
    try {
        if (fs.existsSync(storagePath)) {
            fs.rmSync(storagePath, { recursive: true, force: true });
            return true;
        }
    } catch (error) {
        console.error(`Error deleting storage at ${storagePath}:`, error.message);
        return false;
    }
    return false;
}

/**
 * Perform cleanup of expired files
 */
function cleanup() {
    console.log(`\n[${new Date().toISOString()}] Starting cleanup...`);
    
    const expiredFiles = getExpiredFiles();
    
    if (expiredFiles.length === 0) {
        console.log('No expired files found.');
        return { deleted: 0, errors: 0 };
    }
    
    console.log(`Found ${expiredFiles.length} expired file(s):`);
    
    let deleted = 0;
    let errors = 0;
    
    expiredFiles.forEach(file => {
        console.log(`  - ${file.display_name} (${file.custom_hash})`);
        console.log(`    Expired: ${file.expires_at}`);
        console.log(`    Path: ${file.storage_path}`);
        
        if (DRY_RUN) {
            console.log('    [DRY RUN] Would delete this file');
            return;
        }
        
        try {
            // Delete file from storage
            const storageDeleted = deleteFileStorage(file.storage_path);
            if (storageDeleted) {
                console.log('    ✓ Storage deleted');
            } else {
                console.log('    ⚠ Storage not found or already deleted');
            }
            
            // Delete record from database
            const result = deleteFileRecord(file.id);
            if (result.changes > 0) {
                console.log('    ✓ Database record deleted');
                deleted++;
            } else {
                console.log('    ⚠ Database record not found');
            }
        } catch (error) {
            console.error(`    ✗ Error: ${error.message}`);
            errors++;
        }
    });
    
    console.log(`\nCleanup complete: ${deleted} file(s) deleted, ${errors} error(s)`);
    
    // Run VACUUM to reclaim space
    if (!DRY_RUN && deleted > 0) {
        try {
            db.exec('VACUUM');
            console.log('Database optimized (VACUUM)');
        } catch (error) {
            console.error('Error during VACUUM:', error.message);
        }
    }
    
    return { deleted, errors };
}

/**
 * Run cleanup in daemon mode
 */
function runDaemon() {
    console.log(`
╔════════════════════════════════════════════════════════╗
║                                                        ║
║   🧹 Zipp Cleanup Daemon                               ║
║                                                        ║
║   Running every ${INTERVAL_MS / 60000} minutes                          ║
║   DRY RUN: ${DRY_RUN ? 'YES' : 'NO'}                                   ║
║                                                        ║
╚════════════════════════════════════════════════════════╝
    `);
    
    // Run immediately
    cleanup();
    
    // Schedule subsequent runs
    setInterval(cleanup, INTERVAL_MS);
}

/**
 * Main entry point
 */
function main() {
    if (DAEMON) {
        runDaemon();
    } else {
        console.log(`
╔════════════════════════════════════════════════════════╗
║                                                        ║
║   🧹 Zipp Cleanup Script                               ║
║                                                        ║
║   DRY RUN: ${DRY_RUN ? 'YES' : 'NO'}                                   ║
║                                                        ║
╚════════════════════════════════════════════════════════╝
        `);
        
        cleanup();
        
        // Close database connection
        db.close();
        
        if (!DRY_RUN) {
            console.log('\nDone! Exiting...');
            process.exit(0);
        }
    }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\n\nReceived SIGINT, shutting down gracefully...');
    db.close();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n\nReceived SIGTERM, shutting down gracefully...');
    db.close();
    process.exit(0);
});

// Run main
main();

module.exports = { cleanup, deleteFileStorage };
