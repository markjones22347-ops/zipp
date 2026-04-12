@echo off
chcp 65001 >nul

:: Change to project root
cd /d "%~dp0.."

echo.
echo ===========================================
echo Zipp Git Push Script
echo ===========================================
echo.

:: Check if git is initialized
if not exist ".git" (
    echo WARNING: Git repository not found!
    echo Initializing git repository...
    git init
    echo.
)

:: Check for changes
git status --porcelain >nul 2>&1
if %errorlevel% neq 0 (
    echo Git error occurred.
    goto :end
)

:: Check if there are changes to commit
for /f "tokens=*" %%i in ('git status --porcelain') do (
    goto :has_changes
)
echo No changes to commit.
goto :end

:has_changes
:: Show git status
echo Current changes:
git status --short
echo.

:: Stage all changes
echo Staging all changes...
git add .
echo Changes staged
echo.

:: Get commit message
set COMMIT_MSG=%~1

if "%~1"=="" (
    echo Enter commit message:
    set /p COMMIT_MSG=^> 
    echo.
)

:: Validate commit message
if "%COMMIT_MSG%"=="" (
    echo No commit message provided. Using default.
    set COMMIT_MSG=Update: %date% %time%
)

:: Commit
echo Committing with message: "%COMMIT_MSG%"
git commit -m "%COMMIT_MSG%"
if errorlevel 1 (
    echo Commit failed!
    goto :end
)
echo Committed successfully
echo.

:: Check remote
git remote get-url origin >nul 2>&1
if errorlevel 1 (
    echo WARNING: No remote configured!
    echo.
    echo To add a remote, run:
    echo    git remote add origin https://github.com/username/repo.git
    echo.
    goto :end
)

:: Push
echo Pushing to remote...
git push origin HEAD

if errorlevel 1 (
    echo Push failed!
    echo Make sure you have push access to the repository.
) else (
    echo Pushed successfully!
)

:end
echo.
echo ===========================================
echo Done!
echo ===========================================
echo.

pause
