@echo off
setlocal
cd /d "%~dp0"

echo ========================================
echo ClawX - Windows Dual Build ^(Stable + Latest OpenClaw^)
echo ========================================
echo.
echo [Info] This build outputs 4 Windows installers:
echo        2 app variants ^* 2 OpenClaw tracks ^(stable/new^)
echo.

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [Error] Node.js not found. Please install Node.js 18+
    pause
    exit /b 1
)

where pnpm >nul 2>&1
if %errorlevel% neq 0 (
    echo [Error] pnpm not found. Please install pnpm first.
    pause
    exit /b 1
)

if not "%~1"=="" (
    node set-version.cjs %~1
    if %errorlevel% neq 0 (
        echo.
        echo [Error] Version update failed.
        pause
        exit /b 1
    )
)

call pnpm run package:win:variants
if %errorlevel% neq 0 (
    echo.
    echo [Error] Build process failed.
    pause
    exit /b 1
)

echo.
echo [Done] Dual-track Windows build outputs are in the release directory.
pause
