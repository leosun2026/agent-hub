@echo off
cd /d "%~dp0"
powershell -Command "Start-Process -WindowStyle Hidden -FilePath 'node' -ArgumentList 'server.js'; Start-Sleep -Seconds 2; Start-Process 'http://localhost:3457/'"
