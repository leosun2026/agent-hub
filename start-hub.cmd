@echo off
cd /d "%~dp0"

if not exist "node_modules" (
    echo [Agent Hub] Dependencies not found. Running npm install...
    call npm install
    if errorlevel 1 (
        echo [Agent Hub] npm install failed. Please run "npm install" manually.
        pause
        exit /b 1
    )
    echo [Agent Hub] Dependencies installed successfully.
)

echo Starting Agent Hub...
powershell -Command "Start-Process -WindowStyle Hidden -FilePath 'node' -ArgumentList 'server.js'; Start-Sleep -Seconds 2; Start-Process 'http://localhost:3457/'"
