@echo off
REM Builds VTemplePrintAgent.exe with the C# compiler that ships with
REM Windows (.NET Framework) — no SDK, no NuGet, no admin rights needed.
setlocal
set CSC=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe
if not exist "%CSC%" set CSC=%WINDIR%\Microsoft.NET\Framework\v4.0.30319\csc.exe
if not exist "%CSC%" (
  echo Could not find csc.exe under %WINDIR%\Microsoft.NET\Framework*\v4.0.30319
  exit /b 1
)
if not exist "%~dp0bin" mkdir "%~dp0bin"
"%CSC%" /nologo /target:winexe /out:"%~dp0bin\VTemplePrintAgent.exe" ^
  /reference:System.dll /reference:System.Drawing.dll ^
  "%~dp0Program.cs"
endlocal
