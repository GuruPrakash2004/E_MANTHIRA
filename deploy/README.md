# Installing e-Mandira Pranali on a Windows PC / server

**Works on:** 64-bit Windows 8.1 / 10 / 11 and Windows Server 2012 R2 or newer, Windows PowerShell 4.0+ (5.1 is built into 10/11/2016+).
Needs internet on the server for the first install (Python, the SQL Server ODBC driver and the Python packages are downloaded) -
or see *Offline* below.

## 1. On the development PC - make the package
Double-click **`deploy\Make-Package.cmd`**. It builds the website (if needed) and writes one zip to `_package\`:
the backend, `frontend\dist`, the print bridge, the report files and this installer - but **not** the Python environment,
`node_modules`, `.git`, logs or your `.env` (no passwords travel). Use `-IncludeEnv` only if you want `.env` inside (keep the zip private).

## 2. On the server - install
1. Copy the zip to the server and extract it to a **local disk**, e.g. `D:\eMandira` (not a network share or mapped drive - a Windows
   service cannot use those). Any path works, spaces included.
2. Double-click **`deploy\Install-eMandira.cmd`** and click *Yes* when Windows asks for administrator rights.
3. Choose **1 Install / Repair** and answer the questions (folder, service name, port, database server / name / user / password).
4. At the end it prints the addresses to open, for example `http://192.168.1.20:8030`.

What it does for you: installs Python 3.12 (for all users) and the SQL Server ODBC driver if missing, downloads NSSM (checksum-verified),
builds `backend\.venv`, writes `backend\.env`, registers the Windows service (delayed auto-start, log files with rotation, restart on
crash), opens the firewall port, starts the service and **checks** that `/health` and the web page answer. If something fails it shows
the log lines and tells you what to fix; run it again afterwards - every step can be repeated safely.

| Menu | Use it when |
|---|---|
| 1 Install / Repair | first time on a PC, or when anything is wrong (paused service, wrong paths, broken `.venv`, busy port) |
| 2 Update | you extracted a newer package over the old folder |
| 3 Status and diagnosis | to see the service, NSSM settings, port owner, health check and the last log lines |
| 5 Stop everything, replace files, start again | stops the service, the print bridge and every process using the app folder, waits while you copy the new files (nothing is locked, no "folder in use"), then starts and checks it |
| 4 Uninstall the service | removes the service and the firewall rule (files, `.env`, logs stay) |

## Things it handles so you do not have to
A `.venv` copied from another PC (rebuilt) - a Python installed for one user only (a service cannot use it; installs the all-users one) -
a service pointing at the wrong python / folder (repaired) - a hand-started uvicorn on the port (offers to stop it) - ports reserved by
Hyper-V / WSL / Docker - files locked by the running service during an update - a 32-bit PowerShell window - a network or mapped-drive
install folder (refused with an explanation) - proxies - unsigned or tampered downloads (signatures / checksums are verified).

## Unattended (scripts, many servers)
```
Install-eMandira.cmd -Mode Install -AppPath "D:\eMandira" -Port 8030 -Unattended ^
    -DbServer 192.168.1.3 -DbPort 58639 -DbName vTmplSLV -DbUser sa
```
The password comes from `-DbPassword` or, better, the `EMANDIRA_DB_PASSWORD` environment variable. Exit code 0 = running and healthy,
1 = something failed. `-Mode Update | Restart | Status | Uninstall` work the same way; `-DryRun` shows what would be done without changing anything.

## Offline server (no internet)
Put the files next to the installer before copying: `deploy\installers\python-3.12.10-amd64.exe`, `deploy\installers\msodbcsql.msi`,
`deploy\installers\nssm-2.24-101-g897c7ad.zip` and, for the Python packages, `deploy\wheels\` (made with
`pip download -r backend\requirements.txt -d deploy\wheels` on a PC with internet). `Make-Package` includes these folders.

## Still manual
The **SAP Crystal Reports runtime (32-bit)** for printing the original `.rpt` formats (licensed SAP download - the installer checks for it
and tells you), and the temple's report files in `backend\Rpts`. On every counter PC open the site at the server's address and run the
Print Agent setup from *Print Settings*.

## Where things are
Logs: `backend\logs\service.log`, `service-error.log` (the "Uvicorn running on http://0.0.0.0:8030" line is written there - normal) and
`install-<date>.log` for each run of the installer. The installer remembers your answers (never passwords) in `deploy\install-settings.json`.
