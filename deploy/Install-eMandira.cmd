@echo off
rem e-Mandira Pranali installer - double-click this file.
rem It starts the installer script and (when needed) asks Windows for administrator rights itself.
title e-Mandira Pranali installer
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-eMandira.ps1" %*
if errorlevel 1 (
  echo.
  echo The installer ended with an error. Press any key to close.
  pause >nul
)
