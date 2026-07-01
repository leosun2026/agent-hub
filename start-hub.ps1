$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$logFile = Join-Path $scriptDir "start-log.txt"

# Log start
"=== Agent Hub Start $(Get-Date -Format 'HH:mm:ss') ===" | Out-File $logFile -Encoding utf8
"Script dir: $scriptDir" | Out-File $logFile -Encoding utf8 -Append

try {
    Start-Process -WindowStyle Hidden -FilePath node -ArgumentList 'kun-proxy.js' -WorkingDirectory $scriptDir
    "Kun proxy started" | Out-File $logFile -Encoding utf8 -Append
} catch {
    "Kun proxy error: $_" | Out-File $logFile -Encoding utf8 -Append
}

Start-Sleep 2

try {
    Start-Process -WindowStyle Hidden -FilePath node -ArgumentList 'server.js' -WorkingDirectory $scriptDir
    "Server started" | Out-File $logFile -Encoding utf8 -Append
} catch {
    "Server error: $_" | Out-File $logFile -Encoding utf8 -Append
}

Start-Sleep 3
Start-Process "http://localhost:3457/"
"Browser opened" | Out-File $logFile -Encoding utf8 -Append