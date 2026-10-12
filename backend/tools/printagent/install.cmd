@echo off
REM Manual install for this PC (the normal path is the one-click Setup file
REM downloaded from the app's Print Settings — this script is for dev/testing
REM or reinstalling without re-downloading).
setlocal
set TARGET=%LOCALAPPDATA%\VTemplePrintAgent
taskkill /f /im VTemplePrintAgent.exe >nul 2>nul
if not exist "%TARGET%" mkdir "%TARGET%"
copy /y "%~dp0bin\VTemplePrintAgent.exe" "%TARGET%\VTemplePrintAgent.exe" >nul
if "%~1" neq "" (
  echo %~1>>"%TARGET%\printagent.txt"
)
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v VTemplePrintAgent /t REG_SZ /d "\"%TARGET%\VTemplePrintAgent.exe\"" /f >nul
start "" "%TARGET%\VTemplePrintAgent.exe"
echo Installed and started. Allowed origins file: %TARGET%\printagent.txt
endlocal
