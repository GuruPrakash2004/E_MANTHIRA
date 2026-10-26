<#
.SYNOPSIS
    e-Mandira Pranali - installer / updater / diagnostics for a Windows PC or server.

.DESCRIPTION
    Run it by double-clicking Install-eMandira.cmd (it asks for administrator rights itself).

    Install / Repair : asks for the application folder, installs what is missing (Python 3.12, NSSM, the SQL Server ODBC
                       driver), builds the Python environment, writes backend\.env, registers the Windows service with NSSM,
                       opens the firewall port, starts the service and CHECKS that it really answers.
    Update           : after copying a new version over the old one - stops the service, refreshes the Python packages, starts
                       it again and checks it.
    Status           : shows the service, the NSSM settings, the port owner, the latest log lines and a live health check.
    Uninstall        : removes the service and the firewall rule (your files, .env and logs stay).

    Every step is safe to repeat: running Install again repairs whatever is wrong.
    No secret is ever written to the log. Nothing outside the application folder, the chosen NSSM folder, the service
    registration, the firewall rule and the prerequisites listed above is touched.

.PARAMETER Mode        Menu (default), Install, Update, Status or Uninstall.
.PARAMETER AppPath     The application folder (the one that holds backend\ and frontend\). Asked for when not given.
.PARAMETER ServiceName Windows service name (default eMandiraPranali).
.PARAMETER Port        Port the site listens on (default 8030).
.PARAMETER NssmPath    Where nssm.exe lives or should be placed (default C:\nssm\nssm.exe).
.PARAMETER Unattended  Never ask: use the parameters, the remembered settings and the defaults.
.PARAMETER DryRun      Show what would be done without changing anything.
#>
[CmdletBinding()]
param(
    [ValidateSet('Menu', 'Install', 'Update', 'Status', 'Uninstall')]
    [string]$Mode = 'Menu',
    [string]$AppPath = '',
    [string]$ServiceName = '',
    [int]$Port = 0,
    [string]$NssmPath = '',
    [switch]$Unattended,
    [switch]$DryRun,
    # database answers for a fully unattended first install (the password may also come from the EMANDIRA_DB_PASSWORD variable)
    [string]$DbServer = '',
    [string]$DbPort = '',
    [string]$DbName = '',
    [string]$DbUser = '',
    [string]$DbPassword = ''
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch { }
# use the PC's own proxy settings (with the signed-in user's credentials) for every download
try { $px = [Net.WebRequest]::GetSystemWebProxy(); $px.Credentials = [Net.CredentialCache]::DefaultCredentials; [Net.WebRequest]::DefaultWebProxy = $px } catch { }

# ----------------------------------------------------------------------------------------------------------------------
# Constants (pinned on purpose: a fresh PC must get the same, tested versions)
# ----------------------------------------------------------------------------------------------------------------------
$script:PythonVersion = '3.12.10'
$script:PythonUrl     = "https://www.python.org/ftp/python/$($script:PythonVersion)/python-$($script:PythonVersion)-amd64.exe"
$script:OdbcUrl       = 'https://go.microsoft.com/fwlink/?linkid=2266640'     # Microsoft ODBC Driver 18 for SQL Server, x64 MSI
# NSSM 2.24-101 (the build that works on Windows 10/11 and Server 2016+). nssm.cc is often down, so a mirror is tried too.
$script:NssmSources   = @(
    'https://community.chocolatey.org/api/v2/package/nssm/2.24.101.20180116',
    'https://nssm.cc/ci/nssm-2.24-101-g897c7ad.zip'
)
$script:NssmSha256    = @{ win64 = 'EEE9C44C29C2BE011F1F1E43BB8C3FCA888CB81053022EC5A0060035DE16D848'; win32 = '682F1025B4C410AE78B1C5BDC4DE7AD315F2EFF292C66947C13969930028C98D' }
$script:DefaultService = 'eMandiraPranali'
$script:DefaultPort    = 8030
$script:DefaultNssm    = 'C:\nssm\nssm.exe'
$script:SettingsFile   = Join-Path $PSScriptRoot 'install-settings.json'
$script:BoundArgs      = $PSBoundParameters                         # the script's own arguments, for the elevated re-launch
$script:Transcript     = $null
$script:Problems       = New-Object System.Collections.ArrayList   # things the user still has to do by hand
$script:Failed         = $false                                    # becomes true when a step failed (exit code 1 in unattended runs)
$script:Relaunched     = $false                                    # true in the window that handed over to the elevated copy

# ----------------------------------------------------------------------------------------------------------------------
# Output helpers
# ----------------------------------------------------------------------------------------------------------------------
function Write-Title([string]$text) {
    Write-Host ''
    Write-Host ('=' * 78) -ForegroundColor DarkYellow
    Write-Host "  $text" -ForegroundColor Yellow
    Write-Host ('=' * 78) -ForegroundColor DarkYellow
}
function Write-Step([string]$text) { Write-Host ''; Write-Host ">> $text" -ForegroundColor Cyan }
function Write-Ok([string]$text)   { Write-Host "   [ OK ]  $text" -ForegroundColor Green }
function Write-Fixed([string]$text){ Write-Host "   [DONE]  $text" -ForegroundColor Green }
function Write-Info([string]$text) { Write-Host "           $text" -ForegroundColor Gray }
function Write-Warn2([string]$text){ Write-Host "   [WARN]  $text" -ForegroundColor Yellow }
function Write-Bad([string]$text)  { Write-Host "   [FAIL]  $text" -ForegroundColor Red }
function Write-Dry([string]$text)  { Write-Host "   [DRY ]  would: $text" -ForegroundColor Magenta }

function Add-Todo([string]$text) { [void]$script:Problems.Add($text) }

# Runs a mutating action, or only announces it in a dry run.
function Invoke-Act([string]$what, [scriptblock]$do) {
    if ($DryRun) { Write-Dry $what; return $null }
    return (& $do)
}

# ----------------------------------------------------------------------------------------------------------------------
# Questions
# ----------------------------------------------------------------------------------------------------------------------
function Read-Answer([string]$prompt, [string]$default = '') {
    if ($Unattended) { return $default }
    $suffix = ''
    if ($default -ne '') { $suffix = " [$default]" }
    $v = Read-Host "$prompt$suffix"
    if ([string]::IsNullOrWhiteSpace($v)) { return $default }
    return $v.Trim()
}
function Read-YesNo([string]$prompt, [bool]$default = $true) {
    if ($Unattended) { return $default }
    $hint = 'Y/n'
    if (-not $default) { $hint = 'y/N' }
    while ($true) {
        $v = (Read-Host "$prompt ($hint)").Trim().ToLower()
        if ($v -eq '') { return $default }
        if ($v -in @('y', 'yes')) { return $true }
        if ($v -in @('n', 'no')) { return $false }
    }
}
function Read-Secret([string]$prompt) {
    if ($Unattended) { return '' }
    $s = Read-Host $prompt -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}
function Clean-Path([string]$p) {
    if ($null -eq $p) { return '' }
    $p = $p.Trim().Trim('"').Trim("'").Trim()
    if ($p.Length -gt 3) { $p = $p.TrimEnd('\') }
    return $p
}

# ----------------------------------------------------------------------------------------------------------------------
# Running programs (quoting that survives spaces, capture of stdout/stderr, NSSM's UTF-16 output)
# ----------------------------------------------------------------------------------------------------------------------
function ConvertTo-ArgString([string[]]$list) {
    $parts = foreach ($a in $list) {
        if ($null -eq $a -or $a -eq '') { '""' }
        elseif ($a -match '[\s"]') {
            $q = $a.Replace('"', '\"')
            if ($q.EndsWith('\')) { $q = $q + '\' }
            '"' + $q + '"'
        } else { $a }
    }
    return ($parts -join ' ')
}
function Invoke-Native([string]$File, [string[]]$ArgList = @(), [string]$WorkDir = '', [hashtable]$Env = @{}, [switch]$Dots) {
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $File
    $psi.Arguments = ConvertTo-ArgString $ArgList
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true
    if ($WorkDir) { $psi.WorkingDirectory = $WorkDir }
    foreach ($k in $Env.Keys) { $psi.EnvironmentVariables[$k] = [string]$Env[$k] }
    $p = [System.Diagnostics.Process]::Start($psi)
    $o = $p.StandardOutput.ReadToEndAsync()
    $e = $p.StandardError.ReadToEndAsync()
    if ($Dots) {                                                    # a dot every few seconds so a long job does not look frozen
        while (-not $p.WaitForExit(4000)) { Write-Host -NoNewline '.' }
        Write-Host ''
    }
    $p.WaitForExit()
    return [pscustomobject]@{
        ExitCode = $p.ExitCode
        Output   = ($o.Result -replace "`0", '').Trim()
        Error    = ($e.Result -replace "`0", '').Trim()
    }
}

# ----------------------------------------------------------------------------------------------------------------------
# Settings remembered between runs (never contains a secret)
# ----------------------------------------------------------------------------------------------------------------------
function Get-Remembered {
    if (Test-Path -LiteralPath $script:SettingsFile) {
        try { return (Get-Content -LiteralPath $script:SettingsFile -Raw | ConvertFrom-Json) } catch { }
    }
    return $null
}
function Save-Remembered([hashtable]$values) {
    if ($DryRun) { return }
    try { ($values | ConvertTo-Json) | Set-Content -LiteralPath $script:SettingsFile -Encoding UTF8 } catch { Write-Warn2 "Could not remember the settings: $($_.Exception.Message)" }
}
function Get-Setting($remembered, [string]$name, $fallback) {
    if ($null -ne $remembered -and $remembered.PSObject.Properties.Name -contains $name -and $remembered.$name) { return $remembered.$name }
    return $fallback
}

# ----------------------------------------------------------------------------------------------------------------------
# Administrator rights
# ----------------------------------------------------------------------------------------------------------------------
# Windows version / bitness / PowerShell: stop early with a clear message instead of failing half way.
function Test-Environment {
    Write-Step 'This PC'
    $caption = 'Windows'; $ver = [Environment]::OSVersion.Version
    try {
        $os = Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction Stop
        $caption = $os.Caption; $ver = [version]$os.Version
    } catch { }
    Write-Info "$caption (version $ver), PowerShell $($PSVersionTable.PSVersion), computer $($env:COMPUTERNAME)"
    if (-not [Environment]::Is64BitOperatingSystem) { throw 'A 64-bit version of Windows is required (the Python packages used by the application are 64-bit only).' }
    if ($ver.Major -lt 6 -or ($ver.Major -eq 6 -and $ver.Minor -lt 3)) { throw 'Windows 8.1 / Windows Server 2012 R2 or newer is required (Python 3.12 does not run on older versions).' }
    if ($PSVersionTable.PSVersion.Major -lt 4) { throw 'Windows PowerShell 4.0 or newer is required. Install the Windows Management Framework 5.1 and run this again.' }
    Write-Ok 'Windows, bitness and PowerShell are supported'
}

function Test-Admin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    return ([Security.Principal.WindowsPrincipal]$id).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}
function Get-RelaunchArgs {
    $argList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $PSCommandPath + '"'))
    foreach ($key in $script:BoundArgs.Keys) {
        $val = $script:BoundArgs[$key]
        if ($val -is [switch]) { if ($val.IsPresent) { $argList += "-$key" } }
        else { $argList += "-$key"; $argList += ('"' + ([string]$val) + '"') }
    }
    return $argList
}
function Restart-Elevated {
    Write-Host 'Administrator rights are needed (to install a service and open a firewall port). Asking Windows for them...' -ForegroundColor Yellow
    try {
        $script:Relaunched = $true
        $p = Start-Process -FilePath (Get-PowerShellExe) -ArgumentList (Get-RelaunchArgs) -Verb RunAs -Wait -PassThru
        exit $p.ExitCode
    } catch {
        $script:Relaunched = $false
        Write-Bad 'Administrator rights were not granted, so nothing was changed. Run Install-eMandira.cmd again and choose Yes.'
        if (-not $Unattended) { [void](Read-Host 'Press Enter to close') }
        exit 1
    }
}
# a 32-bit PowerShell on 64-bit Windows sees the wrong registry / Program Files: hand over to the 64-bit one
function Restart-In64Bit {
    $sysnative = Join-Path $env:windir 'sysnative\WindowsPowerShell\v1.0\powershell.exe'
    $script:Relaunched = $true
    $p = Start-Process -FilePath $sysnative -ArgumentList (Get-RelaunchArgs) -Wait -PassThru -NoNewWindow
    exit $p.ExitCode
}
function Get-PowerShellExe {
    if ([Environment]::Is64BitOperatingSystem -and -not [Environment]::Is64BitProcess) { return (Join-Path $env:windir 'sysnative\WindowsPowerShell\v1.0\powershell.exe') }
    return 'powershell.exe'
}

# ----------------------------------------------------------------------------------------------------------------------
# Downloads (TLS 1.2, retries, signature / hash checks)
# ----------------------------------------------------------------------------------------------------------------------
# Installers the user placed next to the script (deploy\installers or deploy\tools) win over the internet - for PCs without one.
function Find-LocalInstaller([string]$filter) {
    foreach ($dir in @((Join-Path $PSScriptRoot 'installers'), (Join-Path $PSScriptRoot 'tools'))) {
        if (Test-Path -LiteralPath $dir) {
            $f = Get-ChildItem -LiteralPath $dir -Filter $filter -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -First 1
            if ($f) { return $f.FullName }
        }
    }
    return $null
}

function Get-Download([string]$url, [string]$dest) {
    for ($i = 1; $i -le 3; $i++) {
        try {
            Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $dest -TimeoutSec 600
            if ((Test-Path -LiteralPath $dest) -and (Get-Item -LiteralPath $dest).Length -gt 0) { return $true }
        } catch {
            Write-Info "download attempt $i failed: $($_.Exception.Message)"
            Start-Sleep -Seconds (2 * $i)
        }
    }
    return $false
}
function Test-Signed([string]$file, [string]$subjectPattern) {
    $sig = Get-AuthenticodeSignature -LiteralPath $file
    if ($sig.Status -ne 'Valid') { return $false }
    return ($sig.SignerCertificate.Subject -match $subjectPattern)
}
function Get-Sha256Hex([byte[]]$bytes) {
    $sha = [Security.Cryptography.SHA256]::Create()
    return ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '')
}

# ----------------------------------------------------------------------------------------------------------------------
# Application folder
# ----------------------------------------------------------------------------------------------------------------------
function Get-AppProblems([string]$root) {
    $missing = @()
    if (-not (Test-Path -LiteralPath (Join-Path $root 'backend\app\main.py')))           { $missing += 'backend\app\main.py' }
    if (-not (Test-Path -LiteralPath (Join-Path $root 'backend\requirements.txt')))      { $missing += 'backend\requirements.txt' }
    if (-not (Test-Path -LiteralPath (Join-Path $root 'frontend\dist\index.html')))      { $missing += 'frontend\dist\index.html (the built web site)' }
    return $missing
}
# Where the application lives matters for a service: it cannot see mapped drives, and a removable or full disk breaks it later.
function Test-AppLocation([string]$path) {
    if ($path.StartsWith('\\')) {
        throw "The application is on a network share ($path). A Windows service cannot rely on a network path. Copy the application to a local disk (for example D:\eMandira) and run this again."
    }
    $drive = $path.Substring(0, 2)
    $disk = $null
    try { $disk = Get-CimInstance -ClassName Win32_LogicalDisk -Filter "DeviceID='$drive'" -ErrorAction Stop } catch { }
    if ($disk) {
        if ($disk.DriveType -eq 4) { throw "Drive $drive is a mapped network drive. A Windows service cannot use mapped drives. Copy the application to a local disk and run this again." }
        if ($disk.DriveType -eq 2) { Write-Warn2 "Drive $drive is removable. If it is unplugged the service will stop working." }
        if ($disk.FreeSpace -lt 1.5GB) { Write-Warn2 ("Only {0:N1} GB free on {1}. The Python packages need about 1.5 GB." -f ($disk.FreeSpace / 1GB), $drive) }
    }
    if ($path.Length -gt 150) { Write-Warn2 'The folder path is very long; Windows may fail to create the Python environment. A shorter path such as D:\eMandira is safer.' }
    if ($path -match '[^\x00-\x7F]') { Write-Warn2 'The folder path contains non-English characters. This normally works, but a plain path such as D:\eMandira is safer.' }
}

function Select-Folder([string]$start) {
    try {
        Add-Type -AssemblyName System.Windows.Forms
        $dlg = New-Object System.Windows.Forms.FolderBrowserDialog
        $dlg.Description = 'Choose the e-Mandira application folder (the one that contains backend and frontend)'
        if ($start -and (Test-Path -LiteralPath $start)) { $dlg.SelectedPath = $start }
        if ($dlg.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { return $dlg.SelectedPath }
    } catch { }
    return ''
}
function Resolve-AppFolder($remembered) {
    $candidates = @()
    if ($AppPath) { $candidates += (Clean-Path $AppPath) }
    $remAppPath = Get-Setting $remembered 'AppPath' ''
    if ($remAppPath) { $candidates += $remAppPath }
    $candidates += (Split-Path -Parent $PSScriptRoot)

    $chosen = ''
    foreach ($c in $candidates) {
        if ($c -and (Test-Path -LiteralPath $c)) {
            $full = (Resolve-Path -LiteralPath $c).Path
            if ((Get-AppProblems $full).Count -eq 0) { $chosen = $full; break }
        }
    }
    if ($chosen -and -not $AppPath -and -not $Unattended) {
        Write-Info "Application folder found: $chosen"
        if (-not (Read-YesNo 'Use this folder?' $true)) { $chosen = '' }
    }
    while (-not $chosen) {
        if ($Unattended) { throw 'The application folder was not found. Give -AppPath "<folder with backend and frontend>".' }
        Write-Host ''
        Write-Host 'Where is the e-Mandira application? It is the folder that contains the "backend" and "frontend" folders.' -ForegroundColor Yellow
        $typed = Read-Answer 'Folder path (or press Enter to browse for it)' ''
        if (-not $typed) { $typed = Select-Folder (Split-Path -Parent $PSScriptRoot) }
        $typed = Clean-Path $typed
        if (-not $typed) { Write-Warn2 'No folder chosen.'; continue }
        if (-not (Test-Path -LiteralPath $typed)) {
            Write-Bad "That folder does not exist: $typed"
            if ($typed -match '^[A-Za-z]:') { Write-Info 'A drive mapped in your normal window is not visible to an administrator window. Use a local disk or the full path.' }
            continue
        }
        $full = (Resolve-Path -LiteralPath $typed).Path
        $problems = Get-AppProblems $full
        if ($problems.Count -eq 0) { $chosen = $full; break }
        Write-Bad "That folder is not a complete e-Mandira application. Missing:"
        foreach ($m in $problems) { Write-Info "- $m" }
        if ($problems -match 'dist') {
            Write-Info 'The web site is built on the development PC with "npm run build" inside the frontend folder;'
            Write-Info 'copy the resulting frontend\dist folder here.'
        }
    }
    Test-AppLocation $chosen
    return $chosen
}

# ----------------------------------------------------------------------------------------------------------------------
# Prerequisites
# ----------------------------------------------------------------------------------------------------------------------
function Test-PythonExe([string]$exe) {
    if (-not $exe -or -not (Test-Path -LiteralPath $exe)) { return $false }
    if ($exe -like '*\WindowsApps\*') { return $false }          # the Microsoft Store stub, not a real Python
    $r = Invoke-Native $exe @('-c', 'import sys,struct;print(sys.version_info[0],sys.version_info[1],struct.calcsize("P")*8)')
    return ($r.ExitCode -eq 0 -and $r.Output -eq '3 12 64')
}
# A Python installed only for one user (under \Users\ or AppData) cannot be used by a Windows service, so it is ignored.
function Test-MachineWidePath([string]$exe) { return ($exe -notmatch '\\Users\\' -and $exe -notmatch '\\AppData\\') }
function Find-Python {
    $found = @()
    $py = Get-Command py.exe -ErrorAction SilentlyContinue
    if ($py) {
        $r = Invoke-Native $py.Source @('-3.12', '-c', 'import sys;print(sys.executable)')
        if ($r.ExitCode -eq 0 -and $r.Output) { $found += $r.Output.Split("`n")[0].Trim() }
    }
    foreach ($hive in @('HKLM:\SOFTWARE\Python\PythonCore\3.12\InstallPath', 'HKCU:\SOFTWARE\Python\PythonCore\3.12\InstallPath')) {
        if (-not (Test-Path -LiteralPath $hive)) { continue }
        $k = Get-ItemProperty -LiteralPath $hive -ErrorAction SilentlyContinue
        if ($k -and $k.ExecutablePath) { $found += $k.ExecutablePath }
        elseif ($k -and $k.'(default)') { $found += (Join-Path $k.'(default)' 'python.exe') }
    }
    $found += (Join-Path $env:ProgramFiles 'Python312\python.exe')
    $found += (Join-Path $env:LOCALAPPDATA 'Programs\Python\Python312\python.exe')
    $cmd = Get-Command python.exe -ErrorAction SilentlyContinue
    if ($cmd) { $found += $cmd.Source }
    $script:UserOnlyPython = $null
    foreach ($f in ($found | Select-Object -Unique)) {
        if (-not (Test-PythonExe $f)) { continue }
        if (Test-MachineWidePath $f) { return $f }
        $script:UserOnlyPython = $f
    }
    return $null
}
function Ensure-Python {
    Write-Step 'Python 3.12 (64-bit, installed for all users)'
    $exe = Find-Python
    if ($exe) { Write-Ok "found: $exe"; return $exe }
    if ($script:UserOnlyPython) { Write-Warn2 "Python 3.12 exists only for one user ($($script:UserOnlyPython)); a service cannot use it, so it is installed for all users." }
    else { Write-Info 'Python 3.12 is not installed. Installing it for all users...' }

    $local = Find-LocalInstaller 'python-3.12*-amd64.exe'
    $winget = Get-Command winget.exe -ErrorAction SilentlyContinue
    if (-not $local -and $winget) {
        Invoke-Act 'winget install Python.Python.3.12 (all users)' {
            $r = Invoke-Native $winget.Source @('install', '--id', 'Python.Python.3.12', '-e', '--scope', 'machine', '--silent', '--accept-package-agreements', '--accept-source-agreements') '' @{} -Dots
            Write-Info "winget finished with code $($r.ExitCode)"
        } | Out-Null
        if (-not $DryRun) { $exe = Find-Python; if ($exe) { Write-Fixed "installed: $exe"; return $exe } }
    }
    if ($DryRun) { Write-Dry "install Python $($script:PythonVersion) silently for all users"; return $null }

    $tmp = $local
    $cleanup = $false
    if (-not $tmp) {
        $tmp = Join-Path $env:TEMP "python-$($script:PythonVersion)-amd64.exe"
        $cleanup = $true
        Write-Info "downloading $($script:PythonUrl)"
        if (-not (Get-Download $script:PythonUrl $tmp)) { throw "Could not download Python. Check the internet connection, or put python-$($script:PythonVersion)-amd64.exe into deploy\installers and run this again." }
    } else { Write-Info "using the installer you provided: $tmp" }
    if (-not (Test-Signed $tmp 'Python Software Foundation')) { if ($cleanup) { Remove-Item -LiteralPath $tmp -Force }; throw 'The Python installer is not signed by the Python Software Foundation. Stopped for safety.' }
    Write-Info 'installing Python (about a minute)...'
    $r = Invoke-Native $tmp @('/quiet', 'InstallAllUsers=1', 'PrependPath=1', 'Include_launcher=1', 'Include_test=0', 'Include_doc=0') '' @{} -Dots
    if ($cleanup) { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue }
    $exe = Find-Python
    if (-not $exe) { throw "Python was installed (exit code $($r.ExitCode)) but cannot be found. Restart the PC and run this again." }
    Write-Fixed "installed: $exe"
    return $exe
}

function Get-NssmExeFromZip([string]$zipPath, [string]$arch, [string]$dest) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [IO.Compression.ZipFile]::OpenRead($zipPath)
    try {
        $entry = $zip.Entries | Where-Object { $_.FullName -match "(^|/)$arch/nssm\.exe$" } | Select-Object -First 1
        if ($entry) {
            $ms = New-Object IO.MemoryStream
            $s = $entry.Open(); $s.CopyTo($ms); $s.Dispose()
            $bytes = $ms.ToArray()
            if ((Get-Sha256Hex $bytes) -ne $script:NssmSha256[$arch]) { throw 'NSSM download does not match the expected checksum.' }
            [IO.File]::WriteAllBytes($dest, $bytes)
            return $true
        }
        $inner = $zip.Entries | Where-Object { $_.FullName -match '\.zip$' } | Select-Object -First 1
        if ($inner) {                                                  # the Chocolatey package wraps the real zip
            $tmpInner = Join-Path $env:TEMP 'nssm-inner.zip'
            [IO.Compression.ZipFileExtensions]::ExtractToFile($inner, $tmpInner, $true)
            try { return (Get-NssmExeFromZip $tmpInner $arch $dest) } finally { Remove-Item -LiteralPath $tmpInner -Force -ErrorAction SilentlyContinue }
        }
    } finally { $zip.Dispose() }
    return $false
}
function Ensure-Nssm([string]$wanted) {
    Write-Step 'NSSM (the tool that runs the app as a Windows service)'
    $candidates = @($wanted, (Join-Path $PSScriptRoot 'tools\nssm.exe'), $script:DefaultNssm)
    $cmd = Get-Command nssm.exe -ErrorAction SilentlyContinue
    if ($cmd) { $candidates += $cmd.Source }
    foreach ($c in $candidates) {
        if ($c -and (Test-Path -LiteralPath $c)) {
            $r = Invoke-Native $c @('version')
            if ($r.ExitCode -eq 0 -or $r.Output -match 'NSSM') {
                Write-Ok "found: $c  ($($r.Output.Split("`n")[0].Trim()))"
                return $c
            }
        }
    }
    Write-Info "NSSM was not found. Placing it at $wanted"
    if ($DryRun) { Write-Dry 'download NSSM 2.24-101 and verify its checksum'; return $wanted }

    $dir = Split-Path -Parent $wanted
    if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    $arch = 'win32'
    if ([Environment]::Is64BitOperatingSystem) { $arch = 'win64' }

    $bundled = Find-LocalInstaller 'nssm*.zip'
    $ok = $false
    if ($bundled) { try { $ok = Get-NssmExeFromZip $bundled $arch $wanted } catch { Write-Info $_.Exception.Message } }
    if (-not $ok) {
        foreach ($url in $script:NssmSources) {
            $tmp = Join-Path $env:TEMP 'nssm-download.zip'
            Write-Info "downloading $url"
            if (-not (Get-Download $url $tmp)) { continue }
            try { $ok = Get-NssmExeFromZip $tmp $arch $wanted } catch { Write-Info $_.Exception.Message }
            Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
            if ($ok) { break }
        }
    }
    if (-not $ok) {
        $winget = Get-Command winget.exe -ErrorAction SilentlyContinue
        if ($winget) {
            Write-Info 'trying winget NSSM.NSSM'
            [void](Invoke-Native $winget.Source @('install', '--id', 'NSSM.NSSM', '-e', '--silent', '--accept-package-agreements', '--accept-source-agreements'))
            $cmd = Get-Command nssm.exe -ErrorAction SilentlyContinue
            if ($cmd) { Write-Fixed "installed: $($cmd.Source)"; return $cmd.Source }
        }
        throw "Could not get NSSM. Download nssm.exe (2.24-101 or newer) yourself, put it at $wanted, and run this again."
    }
    Write-Fixed "NSSM placed at $wanted"
    return $wanted
}

function Get-OdbcDriver {
    $found = @()
    foreach ($key in @('HKLM:\SOFTWARE\ODBC\ODBCINST.INI\ODBC Drivers', 'HKLM:\SOFTWARE\WOW6432Node\ODBC\ODBCINST.INI\ODBC Drivers')) {
        try { $found += (Get-ItemProperty -LiteralPath $key -ErrorAction Stop).PSObject.Properties | Where-Object { $_.Name -match '^ODBC Driver (17|18) for SQL Server$' } | ForEach-Object { $_.Name } } catch { }
    }
    return ($found | Sort-Object -Descending | Select-Object -First 1)
}
function Ensure-Odbc {
    Write-Step 'Microsoft ODBC Driver for SQL Server'
    $d = Get-OdbcDriver
    if ($d) { Write-Ok "found: $d"; return }
    if ($DryRun) { Write-Dry 'install Microsoft ODBC Driver 18 for SQL Server'; return }
    Write-Info 'Installing ODBC Driver 18 for SQL Server (needed to talk to the database)...'
    $tmp = Find-LocalInstaller 'msodbcsql*.msi'
    $cleanup = $false
    if (-not $tmp) {
        $tmp = Join-Path $env:TEMP 'msodbcsql18.msi'
        $cleanup = $true
        if (-not (Get-Download $script:OdbcUrl $tmp)) { Write-Warn2 'Could not download the ODBC driver. Install "ODBC Driver 18 for SQL Server" from Microsoft by hand (or put msodbcsql.msi into deploy\installers).'; Add-Todo 'Install Microsoft ODBC Driver 18 for SQL Server (download failed).'; return }
    } else { Write-Info "using the installer you provided: $tmp" }
    if (-not (Test-Signed $tmp 'Microsoft Corporation')) { if ($cleanup) { Remove-Item -LiteralPath $tmp -Force }; throw 'The ODBC driver installer is not signed by Microsoft. Stopped for safety.' }
    $r = Invoke-Native 'msiexec.exe' @('/i', $tmp, 'IACCEPTMSODBCSQLLICENSETERMS=YES', '/qn', '/norestart') '' @{} -Dots
    if ($cleanup) { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue }
    if ($r.ExitCode -in @(0, 3010)) { Write-Fixed 'ODBC Driver 18 installed'; if ($r.ExitCode -eq 3010) { Add-Todo 'Restart the PC once (the ODBC driver asked for it).' } }
    else { Write-Warn2 "The ODBC driver installer returned code $($r.ExitCode). The app will try the built-in fallback driver, which some servers reject."; Add-Todo 'ODBC Driver 18 for SQL Server did not install - install it by hand.' }
}

function Test-CrystalRuntime {
    foreach ($g in @('assembly\GAC_MSIL', 'Microsoft.NET\assembly\GAC_MSIL')) {
        if (Test-Path -LiteralPath (Join-Path $env:windir "$g\CrystalDecisions.CrystalReports.Engine")) { return $true }
    }
    foreach ($k in @('HKLM:\SOFTWARE\WOW6432Node\SAP BusinessObjects\Crystal Reports for .NET Framework 4.0', 'HKLM:\SOFTWARE\SAP BusinessObjects\Crystal Reports for .NET Framework 4.0')) {
        if (Test-Path -LiteralPath $k) { return $true }
    }
    return $false
}
function Ensure-Crystal([string]$backend) {
    Write-Step 'Crystal Reports runtime (32-bit) - needed only for printing the original .rpt reports'
    $bridge = Join-Path $backend 'tools\rptbridge\bin\RptBridge.exe'
    if (-not (Test-Path -LiteralPath $bridge)) { Write-Warn2 'tools\rptbridge\bin\RptBridge.exe is not in this copy of the app, so RPT printing will not work.'; Add-Todo 'Copy backend\tools\rptbridge\bin (RptBridge.exe) from the development PC for RPT printing.'; return }
    if (Test-CrystalRuntime) { Write-Ok 'the Crystal Reports runtime is installed'; return }
    Write-Warn2 'The SAP Crystal Reports runtime (.NET 4, 32-bit) is not installed. It is a licensed SAP download, so it cannot be fetched automatically.'
    Write-Info 'The website, entry screens and reports work without it; only printing the original .rpt formats needs it.'
    $path = ''
    if (-not $Unattended -and -not $DryRun) {
        $path = Clean-Path (Read-Answer 'Path of the Crystal runtime installer (.msi or .exe) to run now, or press Enter to skip' '')
    }
    if ($path -and (Test-Path -LiteralPath $path)) {
        Write-Info 'installing the Crystal runtime (this can take several minutes)...'
        if ($path -like '*.msi') { $r = Invoke-Native 'msiexec.exe' @('/i', $path, '/qn', '/norestart') } else { $r = Invoke-Native $path @('/quiet', '/norestart') }
        if (Test-CrystalRuntime) { Write-Fixed 'Crystal Reports runtime installed'; return }
        Write-Warn2 "The Crystal installer returned code $($r.ExitCode) and the runtime is still not detected."
    }
    Add-Todo 'Install the SAP Crystal Reports runtime for .NET 4 (32-bit) on this PC to print the original .rpt formats.'
}

# ----------------------------------------------------------------------------------------------------------------------
# Python environment
# ----------------------------------------------------------------------------------------------------------------------
function Get-VenvPython([string]$backend) { return (Join-Path $backend '.venv\Scripts\python.exe') }

# Any process still running from the app's own folders (a hand-started uvicorn, the old print bridge) locks files pip must replace.
function Stop-AppProcesses([string]$backend) {
    $prefixes = @((Join-Path $backend '.venv'), (Join-Path $backend 'tools'))
    $stopped = 0
    foreach ($proc in (Get-CimInstance -ClassName Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.ExecutablePath })) {
        foreach ($pre in $prefixes) {
            if ($proc.ExecutablePath.StartsWith($pre, [StringComparison]::OrdinalIgnoreCase) -and $proc.ProcessId -ne $PID) {
                if ($DryRun) { Write-Dry "stop process $($proc.Name) ($($proc.ProcessId))" }
                else { Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue; $stopped++ }
                break
            }
        }
    }
    if ($stopped -gt 0) { Write-Info "stopped $stopped leftover process(es) that were using the application files"; Start-Sleep -Seconds 2 }
}

function Ensure-Venv([string]$backend, [string]$basePython, [bool]$refreshPackages = $true) {
    Write-Step 'Python environment (backend\.venv)'
    $venvPy = Get-VenvPython $backend
    $healthy = $false
    if (Test-Path -LiteralPath $venvPy) {
        $r = Invoke-Native $venvPy @('-c', 'import sys;print(sys.version_info[0],sys.version_info[1])')
        $healthy = ($r.ExitCode -eq 0 -and $r.Output -eq '3 12')
        if (-not $healthy) { Write-Warn2 'The existing .venv does not work on this PC (it was probably copied from another PC). It will be rebuilt.' }
    }
    if (-not $healthy) {
        if (Test-Path -LiteralPath (Join-Path $backend '.venv')) {
            Invoke-Act 'remove the broken backend\.venv' { Remove-Item -LiteralPath (Join-Path $backend '.venv') -Recurse -Force } | Out-Null
        }
        if ($DryRun) { Write-Dry "create backend\.venv with $basePython"; Write-Dry 'pip install -r requirements.txt'; return $venvPy }
        Write-Info 'creating the virtual environment...'
        $r = Invoke-Native $basePython @('-m', 'venv', (Join-Path $backend '.venv'))
        if ($r.ExitCode -ne 0) { throw "Could not create the Python environment: $($r.Error)" }
        $refreshPackages = $true
        Write-Fixed 'virtual environment created'
    } else { Write-Ok 'the virtual environment works' }

    if ($refreshPackages) {
        if ($DryRun) { Write-Dry 'pip install -r requirements.txt'; return $venvPy }
        Stop-AppProcesses $backend
        Write-Info 'installing the Python packages (a few minutes the first time)...'
        $r = Invoke-Native $venvPy @('-m', 'pip', 'install', '--upgrade', 'pip', '--disable-pip-version-check', '--no-input', '--retries', '5', '--default-timeout', '60') $backend @{} -Dots
        if ($r.ExitCode -ne 0) { Write-Warn2 "pip could not upgrade itself (continuing): $($r.Error)" }
        $pipArgs = @('-m', 'pip', 'install', '-r', 'requirements.txt', '--disable-pip-version-check', '--no-input', '--prefer-binary', '--retries', '5', '--default-timeout', '60')
        $r = Invoke-Native $venvPy $pipArgs $backend @{} -Dots
        $wheels = Join-Path $PSScriptRoot 'wheels'
        if ($r.ExitCode -ne 0 -and (Test-Path -LiteralPath $wheels)) {
            Write-Info 'the internet install failed; trying the offline packages in deploy\wheels ...'
            $r = Invoke-Native $venvPy ($pipArgs + @('--no-index', '--find-links', $wheels)) $backend @{} -Dots
        }
        if ($r.ExitCode -ne 0) {
            Write-Bad 'pip could not install the requirements:'
            ($r.Output + "`n" + $r.Error).Split("`n") | Select-Object -Last 15 | ForEach-Object { Write-Info $_ }
            throw 'Installing the Python packages failed (is the internet working?). Fix that and run Install again.'
        }
        Write-Fixed 'Python packages installed'
    }
    $r = Invoke-Native $venvPy @('-c', 'import app.main; print("IMPORT_OK")') $backend
    if ($r.Output -notmatch 'IMPORT_OK') {
        Write-Bad 'The application does not start:'
        ($r.Output + "`n" + $r.Error).Split("`n") | Select-Object -Last 12 | ForEach-Object { Write-Info $_ }
        throw 'The backend code could not be loaded. See the lines above.'
    }
    Write-Ok 'the application code loads'
    return $venvPy
}

# ----------------------------------------------------------------------------------------------------------------------
# backend\.env
# ----------------------------------------------------------------------------------------------------------------------
function Read-EnvFile([string]$path) {
    $map = @{}
    if (-not (Test-Path -LiteralPath $path)) { return $map }
    foreach ($line in (Get-Content -LiteralPath $path -Encoding UTF8)) {
        if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$') {
            $v = $Matches[2]
            if ($v.Length -ge 2 -and (($v.StartsWith('"') -and $v.EndsWith('"')) -or ($v.StartsWith("'") -and $v.EndsWith("'")))) { $v = $v.Substring(1, $v.Length - 2) }
            $map[$Matches[1]] = $v
        }
    }
    return $map
}
function Format-EnvValue([string]$v) {
    if ($v -match '[\s#"''$\\]') { return "'" + $v.Replace('\', '\\').Replace("'", "\'") + "'" }
    return $v
}
function Set-EnvLine([System.Collections.ArrayList]$lines, [string]$key, [string]$value) {
    $new = "$key=$(Format-EnvValue $value)"
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -match "^\s*$([regex]::Escape($key))\s*=") { $lines[$i] = $new; return }
    }
    [void]$lines.Add($new)
}
function New-RandomSecret {
    $b = New-Object byte[] 48
    $rng = New-Object Security.Cryptography.RNGCryptoServiceProvider
    $rng.GetBytes($b)
    return ([Convert]::ToBase64String($b)).Replace('+', '-').Replace('/', '_').TrimEnd('=')
}
function Test-Database([string]$venvPy, [string]$backend) {
    $r = Invoke-Native $venvPy @('-c', 'from app.core.db import healthcheck; healthcheck(); print("DB_OK")') $backend
    if ($r.Output -match 'DB_OK') { return @{ Ok = $true; Detail = '' } }
    $msg = ($r.Error + "`n" + $r.Output).Trim().Split("`n") | Where-Object { $_ -match 'Error|error|Login|refused|timed out|Cannot|Named Pipes|SSL|certificate' } | Select-Object -Last 3
    if (-not $msg) { $msg = ($r.Error).Split("`n") | Select-Object -Last 3 }
    return @{ Ok = $false; Detail = ($msg -join ' | ') }
}
function Ensure-EnvFile([string]$backend, [string]$venvPy, [int]$port) {
    Write-Step 'Settings file (backend\.env) and database connection'
    $envPath = Join-Path $backend '.env'
    $examplePath = Join-Path $backend '.env.example'
    $exists = Test-Path -LiteralPath $envPath

    if ($exists) {
        Write-Ok 'backend\.env exists'
        if ($DryRun) { return }
        $db = Test-Database $venvPy $backend
        if ($db.Ok) {
            Write-Ok 'the database answers with the current settings'
            if ($Unattended -or -not (Read-YesNo 'Change the database settings anyway?' $false)) { return }
        } else {
            Write-Warn2 "The database does not answer with the current settings: $($db.Detail)"
            if ($Unattended) { Add-Todo 'The database settings in backend\.env do not work - run Install again and re-enter them.'; return }
            if (-not (Read-YesNo 'Re-enter the database settings now?' $true)) { Add-Todo 'The database settings in backend\.env do not work.'; return }
        }
    } else {
        if ($DryRun) { Write-Dry 'create backend\.env from .env.example and ask for the database settings'; return }
        if ($Unattended -and -not $DbServer) { throw 'backend\.env is missing. In unattended mode pass -DbServer, -DbName, -DbUser (and -DbPassword or the EMANDIRA_DB_PASSWORD variable), or create backend\.env first.' }
        Write-Info 'backend\.env does not exist yet. A few questions (the password is never shown or logged):'
    }

    $current = Read-EnvFile $envPath
    $lines = New-Object System.Collections.ArrayList
    $source = $envPath
    if (-not $exists) { $source = $examplePath }
    if (Test-Path -LiteralPath $source) { foreach ($l in (Get-Content -LiteralPath $source -Encoding UTF8)) { [void]$lines.Add($l) } }
    $exampleMap = Read-EnvFile $examplePath

    function Cur([string]$k, [string]$fallback = '') { if ($current.ContainsKey($k) -and $current[$k]) { return $current[$k] }; return $fallback }
    function Pick([string]$given, [string]$fallback) { if ($given) { return $given }; return $fallback }

    $attempt = 0
    while ($true) {
        $attempt++
        $server = Read-Answer 'SQL Server name or IP' (Pick $DbServer (Cur 'DB_SERVER' ''))
        $dbPort = Read-Answer 'SQL Server port (blank for a named instance)' (Pick $DbPort (Cur 'DB_PORT' '1433'))
        $dbName = Read-Answer 'Database name' (Pick $DbName (Cur 'DB_NAME' 'vTmplSLV'))
        $dbUser = Read-Answer 'Database user' (Pick $DbUser (Cur 'DB_USER' 'sa'))
        $pw = Read-Secret 'Database password (Enter = keep the current one)'
        if (-not $pw) { $pw = $DbPassword }
        if (-not $pw) { $pw = $env:EMANDIRA_DB_PASSWORD }
        if (-not $pw) { $pw = Cur 'DB_PASSWORD' '' }

        Set-EnvLine $lines 'APP_ENV' 'production'
        Set-EnvLine $lines 'FRONTEND_ORIGINS' "http://localhost:$port"
        Set-EnvLine $lines 'DB_SERVER' $server
        Set-EnvLine $lines 'DB_PORT' $dbPort
        Set-EnvLine $lines 'DB_NAME' $dbName
        Set-EnvLine $lines 'DB_USER' $dbUser
        Set-EnvLine $lines 'DB_PASSWORD' $pw
        Set-EnvLine $lines 'DB_TRUST_CERT' (Cur 'DB_TRUST_CERT' 'yes')
        Set-EnvLine $lines 'DB_ENGINE' (Cur 'DB_ENGINE' 'pyodbc')

        $secret = Cur 'JWT_SECRET' ''
        if (-not $secret -or $secret -eq 'change-me' -or ($exampleMap.ContainsKey('JWT_SECRET') -and $secret -eq $exampleMap['JWT_SECRET'])) { $secret = New-RandomSecret; Write-Info 'a new random login-token secret was generated' }
        Set-EnvLine $lines 'JWT_SECRET' $secret

        if (-not $exists -and -not $current.ContainsKey('LEGACY_CRYPTO_KEY')) {
            Write-Host ''
            Write-Info 'Legacy password key: it must be the same key the old vTemple7.exe uses, or existing users cannot log in.'
            $legacy = Read-Answer 'LEGACY_CRYPTO_KEY (Enter = the application default)' ''
            if ($legacy) { Set-EnvLine $lines 'LEGACY_CRYPTO_KEY' $legacy }
        }

        Set-EnvLine $lines 'RPT_FOLDER' (Cur 'RPT_FOLDER' '')
        $rptDir = Join-Path $backend 'Rpts'
        if (-not (Cur 'RPT_FOLDER' '') -and -not (Get-ChildItem -LiteralPath $rptDir -Filter *.rpt -ErrorAction SilentlyContinue)) {
            Write-Warn2 'backend\Rpts has no .rpt files. Printing needs the temple''s report files.'
            $rptPath = Clean-Path (Read-Answer 'Folder that holds the .rpt files (Enter to skip)' '')
            if ($rptPath) { Set-EnvLine $lines 'RPT_FOLDER' $rptPath } else { Add-Todo 'Copy the .rpt report files into backend\Rpts (or set RPT_FOLDER in backend\.env).' }
        }

        [IO.File]::WriteAllLines($envPath, [string[]]$lines, (New-Object System.Text.UTF8Encoding($false)))
        $exists = $true
        $current = Read-EnvFile $envPath

        Write-Info 'testing the database connection...'
        $db = Test-Database $venvPy $backend
        if ($db.Ok) { Write-Fixed 'the database answers'; break }
        Write-Bad "The database did not answer: $($db.Detail)"
        if ($Unattended -or $attempt -ge 3 -or -not (Read-YesNo 'Try different settings?' $true)) {
            Add-Todo 'The database connection does not work yet - fix backend\.env (or the Database Settings panel on the login page).'
            break
        }
    }
    # only SYSTEM, Administrators (and later the service account) may read the file that holds the password
    [void](Invoke-Native 'icacls.exe' @($envPath, '/inheritance:r', '/grant:r', '*S-1-5-18:(F)', '*S-1-5-32-544:(F)'))
    Write-Ok 'backend\.env is restricted to administrators and the system'
}

# ----------------------------------------------------------------------------------------------------------------------
# Service, port, firewall
# ----------------------------------------------------------------------------------------------------------------------
function Get-ServiceInfo([string]$name) {
    return (Get-CimInstance -ClassName Win32_Service -Filter "Name='$name'" -ErrorAction SilentlyContinue)
}
function Get-PortOwner([int]$port) {
    $conn = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $conn) { return $null }
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$($conn.OwningProcess)" -ErrorAction SilentlyContinue
    return [pscustomobject]@{ Pid = $conn.OwningProcess; Parent = $proc.ParentProcessId; Name = $proc.Name; Command = $proc.CommandLine }
}
# Hyper-V / WSL / Docker reserve blocks of ports; binding inside one fails with "access denied" although nothing listens there.
function Test-PortExcluded([int]$port) {
    try {
        $r = Invoke-Native 'netsh.exe' @('interface', 'ipv4', 'show', 'excludedportrange', 'protocol=tcp')
        foreach ($l in $r.Output.Split("`n")) {
            if ($l -match '^\s*(\d+)\s+(\d+)') { if ($port -ge [int]$Matches[1] -and $port -le [int]$Matches[2]) { return $true } }
        }
    } catch { }
    return $false
}
function Test-PortIsOurs([int]$port, [string]$serviceName) {
    $owner = Get-PortOwner $port
    if (-not $owner) { return $true }
    $svc = Get-ServiceInfo $serviceName
    if ($svc -and $svc.ProcessId -gt 0 -and ($owner.Pid -eq $svc.ProcessId -or $owner.Parent -eq $svc.ProcessId)) { return $true }
    return $false
}
function Resolve-Port([int]$port, [string]$serviceName) {
    while ($true) {
        if (Test-PortExcluded $port) {
            Write-Warn2 "Port $port is reserved by Windows (Hyper-V / WSL / Docker block of ports) and cannot be used."
            if ($Unattended) { throw "Port $port is reserved by Windows. Pass another -Port." }
            $p = Read-Answer 'Another port to use' ''
            if ($p -match '^\d{2,5}$') { $port = [int]$p }
            continue
        }
        $owner = Get-PortOwner $port
        if (-not $owner -or (Test-PortIsOurs $port $serviceName)) { return $port }
        Write-Warn2 "Port $port is already used by $($owner.Name) (process $($owner.Pid))."
        if ($owner.Command) { Write-Info $owner.Command }
        if ($Unattended) { throw "Port $port is busy. Free it or pass another -Port." }
        $isPython = ($owner.Name -match 'python|uvicorn') -and ($owner.Command -match 'uvicorn')
        if ($isPython -and (Read-YesNo 'That looks like a hand-started uvicorn. Stop it?' $true)) {
            Stop-Process -Id $owner.Pid -Force -ErrorAction SilentlyContinue
            Start-Sleep -Seconds 2
            continue
        }
        $p = Read-Answer 'Another port to use' ''
        if ($p -match '^\d{2,5}$') { $port = [int]$p }
    }
}
function Wait-ServiceState([string]$name, [string]$state, [int]$seconds) {
    $end = (Get-Date).AddSeconds($seconds)
    while ((Get-Date) -lt $end) {
        $s = Get-Service -Name $name -ErrorAction SilentlyContinue
        if ($s -and $s.Status.ToString() -eq $state) { return $true }
        Start-Sleep -Milliseconds 700
    }
    return $false
}
function Stop-AppService([string]$nssm, [string]$name) {
    $s = Get-Service -Name $name -ErrorAction SilentlyContinue
    if (-not $s -or $s.Status -eq 'Stopped') { return }
    [void](Invoke-Native $nssm @('stop', $name))
    if (-not (Wait-ServiceState $name 'Stopped' 25)) {
        $svc = Get-ServiceInfo $name
        if ($svc -and $svc.ProcessId -gt 0) { Stop-Process -Id $svc.ProcessId -Force -ErrorAction SilentlyContinue }
        [void](Wait-ServiceState $name 'Stopped' 10)
    }
}
function Set-NssmValue([string]$nssm, [string]$name, [string[]]$setArgs) {
    $r = Invoke-Native $nssm (@('set', $name) + $setArgs)
    if ($r.ExitCode -ne 0) { throw "nssm set $($setArgs[0]) failed: $($r.Output) $($r.Error)" }
}
function Install-AppService([string]$nssm, [string]$name, [string]$venvPy, [string]$backend, [int]$port, [object]$runAs, [string]$runAsPassword) {
    Write-Step "Windows service '$name'"
    $logs = Join-Path $backend 'logs'
    $params = "-m uvicorn app.main:app --host 0.0.0.0 --port $port"
    if ($DryRun) {
        Write-Dry "create the folder $logs"
        Write-Dry "nssm install/update $name : Application=$venvPy  AppParameters='$params'  AppDirectory=$backend"
        Write-Dry 'auto-start, log files with rotation, restart on exit'
        return
    }
    New-Item -ItemType Directory -Force -Path $logs | Out-Null

    $existing = Get-Service -Name $name -ErrorAction SilentlyContinue
    if ($existing) {
        $oldApp = (Invoke-Native $nssm @('get', $name, 'Application')).Output
        if ($oldApp -and $oldApp -ne $venvPy) { Write-Warn2 "The service pointed at another program ($oldApp). It is now pointed at this application." }
        Stop-AppService $nssm $name
    }
    else {
        $r = Invoke-Native $nssm @('install', $name, $venvPy)
        if ($r.ExitCode -ne 0) { throw "nssm could not install the service: $($r.Output) $($r.Error)" }
        Write-Fixed 'service created'
    }
    # always re-applied, so a service with a wrong path / parameters / folder is repaired by running Install again
    Set-NssmValue $nssm $name @('Application', $venvPy)
    Set-NssmValue $nssm $name @('AppParameters', $params)
    Set-NssmValue $nssm $name @('AppDirectory', $backend)
    Set-NssmValue $nssm $name @('DisplayName', 'e-Mandira Pranali')
    Set-NssmValue $nssm $name @('Description', 'e-Mandira Pranali web application (FastAPI + built web site)')
    Set-NssmValue $nssm $name @('Start', 'SERVICE_DELAYED_AUTO_START')   # after a reboot: wait until the network / database server are up
    Set-NssmValue $nssm $name @('AppStdout', (Join-Path $logs 'service.log'))
    Set-NssmValue $nssm $name @('AppStderr', (Join-Path $logs 'service-error.log'))
    Set-NssmValue $nssm $name @('AppRotateFiles', '1')
    Set-NssmValue $nssm $name @('AppRotateOnline', '1')
    Set-NssmValue $nssm $name @('AppRotateBytes', '10485760')
    Set-NssmValue $nssm $name @('AppExit', 'Default', 'Restart')
    Set-NssmValue $nssm $name @('AppRestartDelay', '5000')
    Set-NssmValue $nssm $name @('AppThrottle', '5000')
    Set-NssmValue $nssm $name @('AppNoConsole', '1')
    Set-NssmValue $nssm $name @('AppEnvironmentExtra', 'PYTHONUNBUFFERED=1', 'PYTHONUTF8=1')
    if ($null -eq $runAs) { }                                   # Update: keep the account the service already uses
    elseif ($runAs -ne '') { Set-NssmValue $nssm $name @('ObjectName', [string]$runAs, $runAsPassword) }
    else { Set-NssmValue $nssm $name @('ObjectName', 'LocalSystem') }
    Write-Ok "service settings applied (python: $venvPy)"
    Write-Info "arguments: $params"
    Write-Info "folder   : $backend"
    Write-Info "logs     : $logs"
}
function Ensure-Firewall([string]$name, [int]$port, $oldPort = $null) {
    Write-Step "Firewall: allow incoming connections on port $port"
    $rule = "eMandiraPranali $port"
    if ($DryRun) { Write-Dry "create the inbound TCP rule '$rule'"; return }
    if ($oldPort -and [int]$oldPort -ne $port) {
        $stale = "eMandiraPranali $oldPort"
        if (Get-NetFirewallRule -DisplayName $stale -ErrorAction SilentlyContinue) { Remove-NetFirewallRule -DisplayName $stale; Write-Fixed "old rule '$stale' removed (the port changed)" }
    }
    $found = Get-NetFirewallRule -DisplayName $rule -ErrorAction SilentlyContinue
    if ($found) { Write-Ok "rule '$rule' exists" }
    else {
        New-NetFirewallRule -DisplayName $rule -Direction Inbound -Action Allow -Protocol TCP -LocalPort $port -Profile Any | Out-Null
        Write-Fixed "rule '$rule' created"
    }
}

# ----------------------------------------------------------------------------------------------------------------------
# Start and verify
# ----------------------------------------------------------------------------------------------------------------------
function Get-Health([int]$port) {
    try {
        $r = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$port/health" -TimeoutSec 8
        return @{ Ok = ($r.StatusCode -eq 200); Status = $r.StatusCode; Body = $r.Content }
    } catch {
        $status = 0; $body = $_.Exception.Message
        if ($_.Exception.Response) {
            try {
                $status = [int]$_.Exception.Response.StatusCode
                $sr = New-Object IO.StreamReader($_.Exception.Response.GetResponseStream())
                $body = $sr.ReadToEnd(); $sr.Dispose()
            } catch { }
        }
        return @{ Ok = $false; Status = $status; Body = $body }
    }
}
function Get-RootPageOk([int]$port) {
    try {
        $r = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$port/" -TimeoutSec 8
        return ($r.StatusCode -eq 200 -and $r.Content -match 'id="root"')
    } catch { return $false }
}
function Show-LogTail([string]$backend, [int]$lines = 40) {
    foreach ($f in @('service-error.log', 'service.log')) {
        $p = Join-Path $backend "logs\$f"
        if (Test-Path -LiteralPath $p) {
            Write-Host ''
            Write-Host "---- last $lines lines of logs\$f ----" -ForegroundColor DarkGray
            Get-Content -LiteralPath $p -Tail $lines -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "   $_" -ForegroundColor DarkGray }
        }
    }
}
function Show-NssmValues([string]$nssm, [string]$name) {
    foreach ($key in @('Application', 'AppParameters', 'AppDirectory', 'ObjectName')) {
        $r = Invoke-Native $nssm @('get', $name, $key)
        Write-Info ("{0,-14}: {1}" -f $key, $r.Output)
    }
}
function Start-AndVerify([string]$nssm, [string]$name, [string]$venvPy, [string]$backend, [int]$port, [object]$runAs, [string]$runAsPassword) {
    Write-Step 'Starting the service and checking that it really works'
    if ($DryRun) { Write-Dry "start the service and wait for http://127.0.0.1:$port/health"; return $true }

    for ($try = 1; $try -le 2; $try++) {
        Stop-AppService $nssm $name
        [void](Invoke-Native $nssm @('start', $name))
        if (Wait-ServiceState $name 'Running' 30) { break }
        $state = (Get-Service -Name $name -ErrorAction SilentlyContinue).Status
        Write-Warn2 "The service is '$state', not Running."
        if ($try -eq 1) {
            Write-Info 'Re-applying the stored settings and trying once more...'
            Install-AppService $nssm $name $venvPy $backend $port $runAs $runAsPassword
        }
    }
    $state = (Get-Service -Name $name -ErrorAction SilentlyContinue).Status
    if ($state -ne 'Running') {
        Write-Bad "The service did not reach Running (it is '$state')."
        Show-NssmValues $nssm $name
        Show-LogTail $backend
        Add-Todo 'The service would not start - see the log lines above (also backend\logs\service-error.log).'
        return $false
    }
    Write-Ok 'the service is Running'

    Write-Info 'waiting for the web server to answer (up to 90 seconds)...'
    $end = (Get-Date).AddSeconds(90)
    $health = @{ Ok = $false; Status = 0; Body = 'no answer' }
    while ((Get-Date) -lt $end) {
        $health = Get-Health $port
        if ($health.Status -in @(200, 503)) { break }
        Start-Sleep -Seconds 2
    }
    if ($health.Status -eq 200) { Write-Ok "http://127.0.0.1:$port/health answers 200 - the database is reachable" }
    elseif ($health.Status -eq 503) {
        Write-Warn2 'The web server is up but the DATABASE does not answer:'
        Write-Info ([string]$health.Body)
        Add-Todo 'The site is running but cannot reach the database. Open the site, click "Database settings" on the login page (or edit backend\.env), then restart the service.'
    } else {
        Write-Bad "The web server did not answer on port $port within 90 seconds ($($health.Body))."
        $owner = Get-PortOwner $port
        if ($owner -and -not (Test-PortIsOurs $port $name)) { Write-Info "Port $port is held by $($owner.Name) (process $($owner.Pid))." }
        Show-NssmValues $nssm $name
        Show-LogTail $backend
        Add-Todo 'The web server did not answer - see the log lines above.'
        return $false
    }
    if (Get-RootPageOk $port) { Write-Ok 'the web page itself loads' }
    else { Write-Warn2 'The server answers but the web page did not load (is frontend\dist complete?).'; Add-Todo 'The web page did not load - re-copy frontend\dist.' }

    $logText = ''
    foreach ($f in @('service.log', 'service-error.log')) { $p = Join-Path $backend "logs\$f"; if (Test-Path -LiteralPath $p) { $logText += (Get-Content -LiteralPath $p -Tail 200 -ErrorAction SilentlyContinue) -join "`n" } }
    if ($logText -match 'real Crystal bridge starting') { Write-Ok 'the print bridge (Crystal) was started' }
    elseif ($logText -match 'bridge not auto-started: (.+)') { Write-Warn2 "the print bridge was not started: $($Matches[1])" }
    return $true
}
function Show-Addresses([int]$port) {
    $ips = @()
    foreach ($nic in [Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces()) {
        if ($nic.OperationalStatus -ne 'Up' -or $nic.NetworkInterfaceType -eq 'Loopback') { continue }
        foreach ($ua in $nic.GetIPProperties().UnicastAddresses) {
            if ($ua.Address.AddressFamily -eq 'InterNetwork' -and $ua.Address.ToString() -notmatch '^169\.254\.') { $ips += $ua.Address.ToString() }
        }
    }
    Write-Host ''
    Write-Host 'Open the site from any PC on the network at:' -ForegroundColor Green
    foreach ($ip in $ips) { Write-Host "    http://${ip}:$port" -ForegroundColor White }
    Write-Host "    http://$($env:COMPUTERNAME):$port" -ForegroundColor White
    Write-Host '  (on each counter PC use the SAME address when running the Print Agent setup in Print Settings)' -ForegroundColor DarkGray
}

# ----------------------------------------------------------------------------------------------------------------------
# Modes
# ----------------------------------------------------------------------------------------------------------------------
function Get-CommonAnswers {
    $rem = Get-Remembered
    $a = @{}
    $a.AppPath = Resolve-AppFolder $rem
    $a.Backend = Join-Path $a.AppPath 'backend'

    $svcDefault = Get-Setting $rem 'ServiceName' $script:DefaultService
    if ($ServiceName) { $svcDefault = $ServiceName }
    $a.ServiceName = Read-Answer 'Service name' $svcDefault
    if ($a.ServiceName -notmatch '^[A-Za-z0-9_.-]+$') { throw 'The service name may only contain letters, digits, dot, dash and underscore.' }

    $portDefault = [int](Get-Setting $rem 'Port' $script:DefaultPort)
    if ($Port -gt 0) { $portDefault = $Port }
    $p = Read-Answer 'Port for the website' ([string]$portDefault)
    if ($p -notmatch '^\d{2,5}$' -or [int]$p -gt 65535) { throw "Not a valid port: $p" }
    $a.Port = [int]$p

    $nssmDefault = Get-Setting $rem 'NssmPath' $script:DefaultNssm
    if ($NssmPath) { $nssmDefault = $NssmPath }
    $a.NssmWanted = Clean-Path (Read-Answer 'NSSM location' $nssmDefault)
    $a.RunAs = Get-Setting $rem 'RunAsUser' ''
    $a.OldPort = Get-Setting $rem 'Port' $null
    return $a
}

function Invoke-Install {
    Write-Title 'INSTALL / REPAIR'
    if ($DryRun) { Write-Warn2 'DRY RUN - nothing will be changed.' }
    $a = Get-CommonAnswers
    $a.Port = Resolve-Port $a.Port $a.ServiceName

    $runAs = $a.RunAs; $runAsPw = ''
    if (-not $Unattended -and -not $DryRun) {
        Write-Host ''
        Write-Info 'The service normally runs as the built-in SYSTEM account. Printing to a specific printer or the Crystal'
        Write-Info 'report fonts can need a real Windows user instead (give it as .\username or DOMAIN\username).'
        $who = Read-Answer 'Run the service as (Enter = SYSTEM; "-" to go back to SYSTEM)' $runAs
        if ($who -eq '-' -or $who -eq '') { $runAs = '' } else { $runAs = $who }
        if ($runAs) { $runAsPw = Read-Secret "Windows password of $runAs" }
    }

    $python = Ensure-Python
    $nssm   = Ensure-Nssm $a.NssmWanted
    Ensure-Odbc
    Ensure-Crystal $a.Backend

    if (-not $DryRun -and (Get-Service -Name $a.ServiceName -ErrorAction SilentlyContinue)) {
        Write-Step 'Stopping the existing service (its files must be free to update)'
        Stop-AppService $nssm $a.ServiceName
        Write-Ok 'stopped'
    }

    $venvPy = Ensure-Venv $a.Backend $python $true
    Ensure-EnvFile $a.Backend $venvPy $a.Port
    Install-AppService $nssm $a.ServiceName $venvPy $a.Backend $a.Port $runAs $runAsPw
    if ($runAs -and -not $DryRun) {
        # a service account other than SYSTEM must read .env and write logs / runtime settings / uploaded media
        [void](Invoke-Native 'icacls.exe' @((Join-Path $a.Backend '.env'), '/grant', "${runAs}:(R)"))
        [void](Invoke-Native 'icacls.exe' @($a.Backend, '/grant', "${runAs}:(OI)(CI)M"))
    }
    Ensure-Firewall $a.ServiceName $a.Port $a.OldPort
    $ok = Start-AndVerify $nssm $a.ServiceName $venvPy $a.Backend $a.Port $runAs $runAsPw
    if (-not $ok) { $script:Failed = $true }

    Save-Remembered @{ AppPath = $a.AppPath; ServiceName = $a.ServiceName; Port = $a.Port; NssmPath = $nssm; RunAsUser = $runAs }
    Show-Summary $a.ServiceName $a.Port $a.Backend $ok
}

function Invoke-Update {
    Write-Title 'UPDATE (after copying a new version of the application)'
    if ($DryRun) { Write-Warn2 'DRY RUN - nothing will be changed.' }
    $a = Get-CommonAnswers
    $nssm = Ensure-Nssm $a.NssmWanted
    $svc = Get-Service -Name $a.ServiceName -ErrorAction SilentlyContinue
    if (-not $svc -and -not $DryRun) { throw "The service '$($a.ServiceName)' does not exist. Choose Install first." }

    Write-Step 'Stopping the service'
    if ($DryRun) { Write-Dry 'stop the service' } else { Stop-AppService $nssm $a.ServiceName; Write-Ok 'stopped' }

    $python = Find-Python
    if (-not $python -and -not $DryRun) { throw 'Python 3.12 is missing. Choose Install (it will install it).' }
    $refresh = $Unattended -or (Read-YesNo 'Refresh the Python packages from requirements.txt?' $true)
    $venvPy = Ensure-Venv $a.Backend $python $refresh

    Write-Step 'Checking the web site files'
    if (Test-Path -LiteralPath (Join-Path $a.AppPath 'frontend\dist\index.html')) { Write-Ok 'frontend\dist is present' } else { throw 'frontend\dist\index.html is missing. Copy the built web site and run Update again.' }

    if (-not $DryRun) {
        $want = "-m uvicorn app.main:app --host 0.0.0.0 --port $($a.Port)"
        $sApp = (Invoke-Native $nssm @('get', $a.ServiceName, 'Application')).Output
        $sDir = (Invoke-Native $nssm @('get', $a.ServiceName, 'AppDirectory')).Output
        $sPar = (Invoke-Native $nssm @('get', $a.ServiceName, 'AppParameters')).Output
        if ($sApp -ne $venvPy -or $sDir -ne $a.Backend -or $sPar -ne $want) {
            Write-Warn2 'The stored service settings differ from this installation - repairing them.'
            Install-AppService $nssm $a.ServiceName $venvPy $a.Backend $a.Port $null ''
        } else { Write-Ok 'the stored service settings are correct' }
    }
    Ensure-Firewall $a.ServiceName $a.Port $a.OldPort
    $ok = Start-AndVerify $nssm $a.ServiceName $venvPy $a.Backend $a.Port $null ''
    if (-not $ok) { $script:Failed = $true }
    Show-Summary $a.ServiceName $a.Port $a.Backend $ok
}

function Invoke-Status {
    Write-Title 'STATUS AND DIAGNOSIS'
    $rem = Get-Remembered
    $name = $script:DefaultService
    if ($ServiceName) { $name = $ServiceName } else { $name = Get-Setting $rem 'ServiceName' $name }
    $portNo = [int](Get-Setting $rem 'Port' $script:DefaultPort)
    if ($Port -gt 0) { $portNo = $Port }
    $appRoot = Get-Setting $rem 'AppPath' (Split-Path -Parent $PSScriptRoot)
    if ($AppPath) { $appRoot = Clean-Path $AppPath }
    $backend = Join-Path $appRoot 'backend'
    $nssm = Get-Setting $rem 'NssmPath' $script:DefaultNssm
    if ($NssmPath) { $nssm = $NssmPath }

    Write-Step 'Service'
    $svc = Get-Service -Name $name -ErrorAction SilentlyContinue
    if (-not $svc) { Write-Bad "No service named '$name'. Run Install."; }
    else {
        $color = 'Green'; if ($svc.Status -ne 'Running') { $color = 'Red' }
        Write-Host "   $name : $($svc.Status)   (start type: $($svc.StartType))" -ForegroundColor $color
        if (Test-Path -LiteralPath $nssm) { Show-NssmValues $nssm $name }
    }
    Write-Step "Port $portNo"
    $owner = Get-PortOwner $portNo
    if ($owner) { Write-Info "listening: $($owner.Name) (process $($owner.Pid))   ours: $(Test-PortIsOurs $portNo $name)" } else { Write-Warn2 'nothing is listening on that port' }
    Write-Step 'Health'
    $h = Get-Health $portNo
    if ($h.Status -eq 200) { Write-Ok '/health = 200 (database reachable)' } else { Write-Bad "/health = $($h.Status) $($h.Body)" }
    if (Get-RootPageOk $portNo) { Write-Ok 'the web page loads' } else { Write-Bad 'the web page does not load' }
    Write-Step 'Firewall'
    if (Get-NetFirewallRule -DisplayName "eMandiraPranali $portNo" -ErrorAction SilentlyContinue) { Write-Ok "rule 'eMandiraPranali $portNo' exists" } else { Write-Warn2 'no firewall rule for this port (other PCs may be blocked)' }
    Write-Step 'Prerequisites'
    $py = Find-Python; if ($py) { Write-Ok "Python: $py" } else { Write-Bad 'Python 3.12 not found' }
    $od = Get-OdbcDriver; if ($od) { Write-Ok "ODBC: $od" } else { Write-Warn2 'no ODBC Driver 17/18 for SQL Server' }
    if (Test-CrystalRuntime) { Write-Ok 'Crystal Reports runtime found' } else { Write-Warn2 'Crystal Reports runtime not found (RPT printing will not work)' }
    Show-LogTail $backend 25
    Show-Addresses $portNo
}

function Invoke-Uninstall {
    Write-Title 'UNINSTALL THE SERVICE'
    if ($DryRun) { Write-Warn2 'DRY RUN - nothing will be changed.' }
    $rem = Get-Remembered
    $name = Read-Answer 'Service name to remove' (Get-Setting $rem 'ServiceName' $script:DefaultService)
    $portNo = [int](Get-Setting $rem 'Port' $script:DefaultPort)
    $nssm = Get-Setting $rem 'NssmPath' $script:DefaultNssm
    if ($NssmPath) { $nssm = $NssmPath }
    $svc = Get-Service -Name $name -ErrorAction SilentlyContinue
    if (-not $svc) { Write-Warn2 "No service named '$name'." }
    elseif ($Unattended -or (Read-YesNo "Remove the service '$name'? (the application files, backend\.env and logs are kept)" $false)) {
        if (-not (Test-Path -LiteralPath $nssm)) { $c = Get-Command nssm.exe -ErrorAction SilentlyContinue; if ($c) { $nssm = $c.Source } }
        Invoke-Act "stop and remove the service $name" {
            Stop-AppService $nssm $name
            $r = Invoke-Native $nssm @('remove', $name, 'confirm')
            if ($r.ExitCode -eq 0) { Write-Fixed 'service removed' } else { Write-Bad "nssm remove failed: $($r.Output) $($r.Error)" }
        } | Out-Null
    }
    $rule = "eMandiraPranali $portNo"
    if (Get-NetFirewallRule -DisplayName $rule -ErrorAction SilentlyContinue) {
        Invoke-Act "delete the firewall rule '$rule'" { Remove-NetFirewallRule -DisplayName $rule; Write-Fixed "firewall rule '$rule' removed" } | Out-Null
    }
}

function Show-Summary([string]$name, [int]$port, [string]$backend, [bool]$ok) {
    Write-Title 'RESULT'
    if ($DryRun) { Write-Host '  Dry run finished - nothing was changed.' -ForegroundColor Magenta; return }
    if ($ok -and $script:Problems.Count -eq 0) { Write-Host '  e-Mandira Pranali is installed and running.' -ForegroundColor Green }
    elseif ($ok) { Write-Host '  e-Mandira Pranali is running, with the points below still to do.' -ForegroundColor Yellow }
    else { Write-Host '  The service is NOT working yet. Read the messages above.' -ForegroundColor Red }
    if ($ok) { Show-Addresses $port }
    if ($script:Problems.Count -gt 0) {
        Write-Host ''
        Write-Host 'Still to do:' -ForegroundColor Yellow
        $n = 1
        foreach ($t in $script:Problems) { Write-Host "  $n. $t" -ForegroundColor Yellow; $n++ }
    }
    Write-Host ''
    Write-Host "Service : $name      Logs: $(Join-Path $backend 'logs')" -ForegroundColor DarkGray
    Write-Host 'Run this program again any time: Install repairs, Update refreshes, Status diagnoses.' -ForegroundColor DarkGray
}

function Show-Menu {
    while ($true) {
        Write-Title 'e-Mandira Pranali - installer'
        Write-Host '   1  Install / Repair   (first time on a PC, or when something is wrong)'
        Write-Host '   2  Update             (after copying a new version of the application)'
        Write-Host '   3  Status and diagnosis'
        Write-Host '   4  Uninstall the service'
        Write-Host '   0  Exit'
        $c = (Read-Host 'Choose').Trim()
        switch ($c) {
            '1' { Invoke-Guarded { Invoke-Install } }
            '2' { Invoke-Guarded { Invoke-Update } }
            '3' { Invoke-Guarded { Invoke-Status } }
            '4' { Invoke-Guarded { Invoke-Uninstall } }
            '0' { return }
            default { }
        }
    }
}
function Invoke-Guarded([scriptblock]$block) {
    try { & $block }
    catch {
        $script:Failed = $true
        Write-Host ''
        Write-Bad $_.Exception.Message
        if ($_.InvocationInfo) { Write-Info ("at " + $_.InvocationInfo.ScriptName + ":" + $_.InvocationInfo.ScriptLineNumber) }
        Write-Info 'Nothing is lost: fix the point above and run it again (every step can be repeated).'
    }
}

# ----------------------------------------------------------------------------------------------------------------------
# Main
# ----------------------------------------------------------------------------------------------------------------------
try {
    $logFile = Join-Path $env:TEMP ("eMandira-install-{0:yyyyMMdd-HHmmss}.log" -f (Get-Date))
    try { Start-Transcript -Path $logFile -Force | Out-Null; $script:Transcript = $logFile } catch { }

    Write-Title 'e-Mandira Pranali - installer'
    # a 32-bit PowerShell on 64-bit Windows: continue in the 64-bit one
    if ([Environment]::Is64BitOperatingSystem -and -not [Environment]::Is64BitProcess) { Restart-In64Bit }

    $envOk = $true
    try { Test-Environment } catch { Write-Bad $_.Exception.Message; $script:Failed = $true; $envOk = $false }

    if ($envOk) {
        $needsAdmin = (-not $DryRun) -and ($Mode -ne 'Status')
        if ($needsAdmin -and -not (Test-Admin)) { Restart-Elevated }

        switch ($Mode) {
            'Install'   { Invoke-Guarded { Invoke-Install } }
            'Update'    { Invoke-Guarded { Invoke-Update } }
            'Status'    { Invoke-Guarded { Invoke-Status } }
            'Uninstall' { Invoke-Guarded { Invoke-Uninstall } }
            default     { Show-Menu }
        }
    }
} finally {
    try {
        if ($script:Transcript) {
            Stop-Transcript | Out-Null
            $rem = Get-Remembered
            $dest = Get-Setting $rem 'AppPath' ''
            if ($dest -and (Test-Path -LiteralPath (Join-Path $dest 'backend')) -and -not $DryRun) {
                $logs = Join-Path $dest 'backend\logs'
                New-Item -ItemType Directory -Force -Path $logs | Out-Null
                Copy-Item -LiteralPath $script:Transcript -Destination (Join-Path $logs (Split-Path -Leaf $script:Transcript)) -Force
            }
        }
    } catch { }
    if (-not $Unattended -and -not $script:Relaunched) { Write-Host ''; [void](Read-Host 'Press Enter to close') }
}
if ($script:Failed -and $Unattended) { exit 1 }
