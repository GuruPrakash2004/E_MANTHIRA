@echo off
rem Builds the zip to copy to a server (see Make-Package.ps1). Double-click on the development PC.
title e-Mandira package builder
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Make-Package.ps1" %*
