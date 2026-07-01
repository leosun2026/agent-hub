@echo off
cd /d "%~dp0"

netstat -ano 2>nul | findstr ":3457 " | findstr "LISTENING" >nul
if not errorlevel 1 (
    echo [Agent Hub] ERROR: Port 3457 is already in use.
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo [Agent Hub] Installing dependencies...
    call npm install
    if errorlevel 1 (
        echo [Agent Hub] npm install failed.
        pause
        exit /b 1
    )
)

echo Starting Agent Hub...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-hub.ps1"