@echo off
setlocal
cd /d "%~dp0"

echo ========================================
echo ClawX - Update OpenClaw
echo ========================================
echo.

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [Error] Node.js not found. Please install Node.js first.
    pause
    exit /b 1
)

set "TARGET_VERSION=%~1"

if "%TARGET_VERSION%"=="" (
    set /p TARGET_VERSION=请输入 OpenClaw 版本（例如 2026.4.14）:
)

if "%TARGET_VERSION%"=="" (
    echo [Error] No version provided.
    pause
    exit /b 1
)

node scripts\replace-openclaw-package.cjs %TARGET_VERSION%
if %errorlevel% neq 0 (
    rem Fallback to PowerShell implementation (more stable on Windows long paths)
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\update-openclaw.ps1 -Version %TARGET_VERSION%
    if %errorlevel% neq 0 (
        echo.
        echo [Error] OpenClaw update failed.
        pause
        exit /b 1
    )
)

echo.
echo [Done] OpenClaw updated to %TARGET_VERSION%
pause
