<#
.SYNOPSIS
    Builds ONE zip file to copy to a server: the backend, the built website and the installer - without the things that must not travel
    (the Python environment, node_modules, .git, logs, your .env with its passwords).

.DESCRIPTION
    Run on the development PC (double-click Make-Package.cmd). On the server: extract the zip anywhere (for example D:\eMandira),
    double-click deploy\Install-eMandira.cmd, choose 1.

.PARAMETER OutputDir   Where the zip is written (default: <app>\_package).
.PARAMETER Build       Rebuild the website with "npm run build" first (default: only when frontend\dist is missing or older than the source).
.PARAMETER NoBuild     Never build; use frontend\dist as it is.
.PARAMETER IncludeEnv  Also put backend\.env and runtime_db_settings.json into the zip (they hold passwords - keep the zip private).
#>
[CmdletBinding()]
param(
    [string]$OutputDir = '',
    [switch]$Build,
    [switch]$NoBuild,
    [switch]$IncludeEnv,
    [switch]$NoPause
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Say([string]$text, [string]$color = 'Gray') { Write-Host $text -ForegroundColor $color }

try {
    $root = Split-Path -Parent $PSScriptRoot
    foreach ($need in @('backend\app\main.py', 'backend\requirements.txt', 'frontend\package.json', 'deploy\Install-eMandira.ps1')) {
        if (-not (Test-Path -LiteralPath (Join-Path $root $need))) { throw "This does not look like the application folder: $need is missing." }
    }
    if (-not $OutputDir) { $OutputDir = Join-Path $root '_package' }
    $dist = Join-Path $root 'frontend\dist'
    $distIndex = Join-Path $dist 'index.html'

    # ---- 1. the website ---------------------------------------------------------------------------------------------
    Say ''
    Say '>> The website (frontend\dist)' Cyan
    $needBuild = $Build.IsPresent
    if (-not $NoBuild -and -not $needBuild) {
        if (-not (Test-Path -LiteralPath $distIndex)) { $needBuild = $true }
        else {
            $distTime = (Get-Item -LiteralPath $distIndex).LastWriteTime
            $newest = Get-ChildItem -LiteralPath (Join-Path $root 'frontend\src') -Recurse -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
            if ($newest -and $newest.LastWriteTime -gt $distTime) { $needBuild = $true; Say "   the source changed after the last build ($($newest.Name))" }
        }
    }
    if ($needBuild -and -not $NoBuild) {
        $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
        if (-not $npm) { throw 'The website must be (re)built but Node.js / npm is not installed on this PC. Install Node.js LTS, or build it elsewhere and run this with -NoBuild.' }
        Say '   running: npm run build (a minute or two)...'
        $front = Join-Path $root 'frontend'
        if (-not (Test-Path -LiteralPath (Join-Path $front 'node_modules'))) {
            Say '   node_modules is missing: running npm install first...'
            $p = Start-Process -FilePath $npm.Source -ArgumentList 'install' -WorkingDirectory $front -Wait -PassThru -NoNewWindow
            if ($p.ExitCode -ne 0) { throw 'npm install failed.' }
        }
        $p = Start-Process -FilePath $npm.Source -ArgumentList @('run', 'build') -WorkingDirectory $front -Wait -PassThru -NoNewWindow
        if ($p.ExitCode -ne 0) { throw 'npm run build failed. Fix the errors above and run this again.' }
    }
    if (-not (Test-Path -LiteralPath $distIndex)) { throw 'frontend\dist\index.html does not exist. Build the website first (cd frontend; npm run build).' }
    # a build made with the development settings would call http://localhost:8010 from every counter PC
    $bad = Get-ChildItem -LiteralPath $dist -Recurse -File -Include *.js | Select-String -Pattern 'localhost:8010' -List | Select-Object -First 1
    if ($bad) { throw "frontend\dist was built with the development API address (found localhost:8010 in $($bad.Filename)). Rebuild it with 'npm run build' (production mode) and run this again." }
    Say '   OK  (built for the production address /api/v1)' Green

    # ---- 2. stage the files -----------------------------------------------------------------------------------------
    Say ''
    Say '>> Collecting the files' Cyan
    $stamp = Get-Date -Format 'yyyyMMdd-HHmm'
    $stage = Join-Path $env:TEMP "eMandira-stage-$stamp"
    if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
    $top = Join-Path $stage 'eMandira'
    New-Item -ItemType Directory -Force -Path $top | Out-Null

    function Copy-Tree([string]$from, [string]$to, [string[]]$skipDirs = @(), [string[]]$skipFiles = @()) {
        $args2 = @($from, $to, '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/NP')
        if ($skipDirs.Count)  { $args2 += '/XD'; $args2 += $skipDirs }
        if ($skipFiles.Count) { $args2 += '/XF'; $args2 += $skipFiles }
        & robocopy.exe @args2 | Out-Null
        if ($LASTEXITCODE -ge 8) { throw "robocopy failed copying $from (code $LASTEXITCODE)" }
    }

    $backendSkipFiles = @('*.pyc', '*.log')
    if (-not $IncludeEnv) { $backendSkipFiles += @('.env', 'runtime_db_settings.json') }
    Copy-Tree (Join-Path $root 'backend') (Join-Path $top 'backend') @('.venv', 'logs', '__pycache__', '.pytest_cache', 'tests', 'welcome_media') $backendSkipFiles
    Copy-Tree $dist (Join-Path $top 'frontend\dist')
    Copy-Tree (Join-Path $root 'deploy') (Join-Path $top 'deploy') @('_package', 'installers', 'wheels') @('install-settings.json')
    $installers = Join-Path $root 'deploy\installers'
    if (Test-Path -LiteralPath $installers) { Copy-Tree $installers (Join-Path $top 'deploy\installers') }     # offline installers travel along
    $wheels = Join-Path $root 'deploy\wheels'
    if (Test-Path -LiteralPath $wheels) { Copy-Tree $wheels (Join-Path $top 'deploy\wheels') }
    if (Test-Path -LiteralPath (Join-Path $root 'README.md')) { Copy-Item -LiteralPath (Join-Path $root 'README.md') -Destination $top }

    $commit = ''
    try { $commit = (& git -C $root rev-parse --short HEAD 2>$null) } catch { }
    $info = @(
        "e-Mandira Pranali package built $(Get-Date -Format 'yyyy-MM-dd HH:mm') on $($env:COMPUTERNAME)",
        "source commit : $commit",
        "contains .env : $($IncludeEnv.IsPresent)",
        '',
        'On the server: extract this zip (for example to D:\eMandira), open the deploy folder, double-click Install-eMandira.cmd and choose 1.'
    )
    Set-Content -LiteralPath (Join-Path $top 'PACKAGE-INFO.txt') -Value $info -Encoding UTF8

    # ---- 3. the zip -------------------------------------------------------------------------------------------------
    Say ''
    Say '>> Creating the zip' Cyan
    New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
    $zip = Join-Path $OutputDir "eMandira-package-$stamp.zip"
    if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::CreateFromDirectory($stage, $zip, [IO.Compression.CompressionLevel]::Optimal, $false)
    Remove-Item -LiteralPath $stage -Recurse -Force

    $mb = [math]::Round((Get-Item -LiteralPath $zip).Length / 1MB, 1)
    Say ''
    Say "Package ready ($mb MB):" Green
    Say "    $zip" White
    Say ''
    Say 'Copy it to the server, extract it (for example to D:\eMandira), run deploy\Install-eMandira.cmd and choose 1.' Gray
    if (-not $IncludeEnv) { Say 'The database password is NOT in the package - the installer asks for it on the server.' Gray }
    else { Say 'WARNING: this zip contains backend\.env (passwords). Keep it private.' Yellow }
} catch {
    Write-Host ''
    Write-Host "FAILED: $($_.Exception.Message)" -ForegroundColor Red
    $global:LASTEXITCODE = 1
}
if (-not $NoPause) { Write-Host ''; [void](Read-Host 'Press Enter to close') }
