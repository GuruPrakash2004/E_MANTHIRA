@echo off
REM Builds bin\RptBridge.exe (x86 .NET Framework). Usage: build.cmd [folder-with-CrystalDecisions-DLLs]
REM With no argument the DLLs are looked up in the GAC (they are there once the Crystal runtime is installed).
REM Compiles with the csc.exe that ships with Windows (no SDK needed). `dotnet build -p:CrystalDllDir=...` with RptBridge.csproj also works.
setlocal
set DLLDIR=%~1
set GAC=%WINDIR%\assembly\GAC_MSIL
if "%DLLDIR%"=="" (
  for /d %%d in ("%GAC%\CrystalDecisions.CrystalReports.Engine\*") do set ENG=%%d\CrystalDecisions.CrystalReports.Engine.dll
  for /d %%d in ("%GAC%\CrystalDecisions.Shared\*") do set SHR=%%d\CrystalDecisions.Shared.dll
) else (
  set ENG=%DLLDIR%\CrystalDecisions.CrystalReports.Engine.dll
  set SHR=%DLLDIR%\CrystalDecisions.Shared.dll
)
if not exist "%ENG%" (echo Crystal DLLs not found. Pass the folder that holds them: build.cmd "C:\path" & exit /b 1)
if not exist "%~dp0bin" mkdir "%~dp0bin"
set CSC=%WINDIR%\Microsoft.NET\Framework\v4.0.30319\csc.exe
"%CSC%" /nologo /platform:x86 /target:exe /out:"%~dp0bin\RptBridge.exe" ^
  /reference:System.dll /reference:System.Drawing.dll /reference:System.Web.Extensions.dll ^
  /reference:"%ENG%" /reference:"%SHR%" "%~dp0Program.cs"
if errorlevel 1 exit /b 1
copy /y "%ENG%" "%~dp0bin\" >nul
copy /y "%SHR%" "%~dp0bin\" >nul
echo Built %~dp0bin\RptBridge.exe
endlocal
