@echo off
REM Starts the bridge by hand: run.cmd <key> [port]. The backend normally launches it itself (roadmap step 7).
setlocal
set PORT=%~2
if "%PORT%"=="" set PORT=8100
if "%~1"=="" (echo Usage: run.cmd ^<key^> [port] & exit /b 1)
set BACKEND=%~dp0..\..
"%~dp0bin\RptBridge.exe" --key "%~1" --port %PORT% --env "%BACKEND%\.env" --settings "%BACKEND%\runtime_db_settings.json" --rpts "%BACKEND%\Rpts"
endlocal
