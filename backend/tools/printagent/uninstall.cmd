@echo off
setlocal
set TARGET=%LOCALAPPDATA%\VTemplePrintAgent
taskkill /f /im VTemplePrintAgent.exe >nul 2>nul
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v VTemplePrintAgent /f >nul 2>nul
rmdir /s /q "%TARGET%" >nul 2>nul
echo Removed.
endlocal
