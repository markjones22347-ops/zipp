/**
 * Zipp File Hosting Service - Main Server Entry Point
 * Express server with SQLite database and file upload support
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const routes = require('./routes');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static files
app.use(express.static(path.join(__dirname, '..', 'public')));

// API routes
app.use('/api', routes);

// Download routes (mounted at root)
app.use('/', routes);

// Root route - serve the main application
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        success: false,
        error: 'Not found'
    });
});

// Error handler
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({
        success: false,
        error: 'Internal server error'
    });
});

// Ensure required directories exist
function ensureDirectories() {
    const dirs = [
        path.join(__dirname, '..', 'uploads'),
        path.join(__dirname, '..', 'db')
    ];
    
    dirs.forEach(dir => {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
            console.log(`Created directory: ${dir}`);
        }
    });
}

// Handle uncaught errors
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Start server
try {
    ensureDirectories();
    
    const server = app.listen(PORT, '0.0.0.0', () => {
        console.log(`
╔════════════════════════════════════════════════════════╗
║                                                        ║
║   🚀 Zipp File Hosting Service                        ║
║                                                        ║
║   Server running at: http://0.0.0.0:${PORT}          
║   Environment PORT: ${process.env.PORT || 'not set'}    ║
║                                                        ║
║   • Upload endpoint: POST /api/upload                   ║
║   • Download page: GET /d/:hash                       ║
║   • Health check: GET /health                         ║
║                                                        ║
╚════════════════════════════════════════════════════════╝
        `);
    });
    
    server.on('error', (err) => {
        console.error('Server error:', err);
    });
} catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
}

module.exports = app;
