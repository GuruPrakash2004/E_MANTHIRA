# Starts the dev print service (port 8100) and the API (port 8010) together.
#   cd backend ; .\start-dev.ps1
# Ctrl+C stops the API; the print service window is closed with it.
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$py = Join-Path $root '.venv\Scripts\python.exe'

# 1. print service (mock Crystal bridge) - skip if something already answers on 8100
$up = $false
try { $up = (Invoke-WebRequest 'http://localhost:8100/health' -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200 } catch {}
if (-not $up) {
    $bridge = Start-Process -FilePath $py -ArgumentList '-m', 'uvicorn', 'mock_bridge:app', '--port', '8100' `
        -WorkingDirectory (Join-Path $root 'print_service') -WindowStyle Minimized -PassThru
    Write-Host "Print service started (pid $($bridge.Id)) on http://localhost:8100"
} else {
    Write-Host 'Print service already running on http://localhost:8100'
}

# 2. API (foreground)
try {
    & $py -m uvicorn app.main:app --reload --port 8010
} finally {
    if ($bridge) { Stop-Process -Id $bridge.Id -Force -ErrorAction SilentlyContinue }
}
