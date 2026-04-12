@echo off
chcp 65001 >nul
title Zipp Dev Server

:: Change to project root
cd /d "%~dp0.."

echo.
echo ╔════════════════════════════════════════════════════════╗
echo ║                                                        ║
echo ║   🚀 Zipp Development Server                           ║
echo ║                                                        ║
echo ╚════════════════════════════════════════════════════════╝
echo.

:: Check for node_modules
if not exist "node_modules" (
    echo 📦 Installing dependencies...
    echo.
    call npm install
    if errorlevel 1 (
        echo.
        echo ❌ Failed to install dependencies!
        echo 💡 Make sure Node.js is installed.
        pause
        exit /b 1
    )
    echo ✅ Dependencies installed
echo.
)

:: Check for database directory
if not exist "db" mkdir db

:: Check for uploads directory
if not exist "uploads" mkdir uploads

echo 🌐 Starting server...
echo 💡 Press Ctrl+C to stop
echo.
echo ────────────────────────────────────────────────────────
echo.

:: Run the server
npm start

:: Keep window open if server crashes
echo.
echo ────────────────────────────────────────────────────────
echo.
echo ⚠️  Server stopped.
echo.
pause
