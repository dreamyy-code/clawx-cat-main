@echo off
setlocal
cd /d "%~dp0"

echo ========================================
echo ClawX - Set Version
echo ========================================
echo.

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [Error] Node.js not found. Please install Node.js 18+
    pause
    exit /b 1
)

set "TARGET_VERSION=%~1"

if "%TARGET_VERSION%"=="" (
    set /p TARGET_VERSION=请输入新的版本号（例如 0.3.9）:
)

if "%TARGET_VERSION%"=="" (
    echo [Error] No version provided.
    pause
    exit /b 1
)

node set-version.cjs %TARGET_VERSION%
if %errorlevel% neq 0 (
    echo.
    echo [Error] Version update failed.
    pause
    exit /b 1
)

echo.
echo [Done] Version updated to %TARGET_VERSION%
pause
