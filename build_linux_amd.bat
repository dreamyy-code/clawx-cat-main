@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set "VERSION_ARG="
if not "%~1"=="" set "VERSION_ARG=-Version %~1"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\build-linux-package.ps1" -Arch x64 %VERSION_ARG%
set "EXIT_CODE=%errorlevel%"

if %EXIT_CODE% neq 0 (
    echo.
    echo [Error] AMD64 Debian build failed.
    pause
    exit /b %EXIT_CODE%
)

echo.
echo [Done] AMD64 Debian dual-track build finished successfully.
echo [Info] Output includes both stable and latest OpenClaw package variants.
echo [Info] Output directory also includes update/start/set-token/uninstall scripts.
pause
