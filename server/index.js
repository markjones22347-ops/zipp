/**
 * Zipp File Hosting Service - Minimal Railway Version
 */

const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

console.log('=== SERVER STARTING ===');
console.log('PORT:', PORT);
console.log('Time:', new Date().toISOString());

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Ensure directories
const uploadsDir = path.join(__dirname, '..', 'uploads');
const dbDir = path.join(__dirname, '..', 'db');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
console.log('Directories ready');

// Test route - no DB
app.get('/test', (req, res) => {
    console.log('Test route hit');
    res.json({ ok: true, time: Date.now() });
});

// Health check endpoint - CRITICAL for Railway
app.get('/health', (req, res) => {
    console.log('Health check - sending 200 OK');
    res.status(200).json({ status: 'ok' });
});

// Simple ping endpoint for Railway
app.get('/ping', (req, res) => {
    res.status(200).send('pong');
});

// Static files
app.use(express.static(path.join(__dirname, '..', 'public')));

// Root
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// API and download routes
try {
    const routes = require('./routes');
    app.use('/api', routes);
    app.use('/', routes);
    console.log('Routes loaded');
} catch (err) {
    console.error('Routes failed:', err.message);
}

// 404
app.use((req, res) => {
    res.status(404).send('Not found');
});

// Error handler
app.use((err, req, res, next) => {
    console.error('ERROR:', err);
    res.status(500).send('Error');
});

// Handle crashes
process.on('uncaughtException', (err) => {
    console.error('CRASH:', err);
});

process.on('unhandledRejection', (reason) => {
    console.error('REJECTION:', reason);
});

// Start
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log('=== SERVER LISTENING ON', PORT, '===');
});

server.on('error', (err) => {
    console.error('Server failed:', err);
});
