@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "PS_SCRIPT=%SCRIPT_DIR%windows-hardware-identity-probe.ps1"

if not exist "%PS_SCRIPT%" (
  echo Missing probe script:
  echo "%PS_SCRIPT%"
  echo.
  echo Keep this BAT file and windows-hardware-identity-probe.ps1 in the same folder.
  pause
  exit /b 1
)

echo Collecting read-only hardware identity data for asset 35...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PS_SCRIPT%" -AssetNumber "35"
set "EXIT_CODE=%ERRORLEVEL%"

echo.
if "%EXIT_CODE%"=="0" (
  echo Completed. Send the 35-windows-hardware-identity-probe.json file from your Desktop for analysis.
) else (
  echo Probe failed with exit code %EXIT_CODE%.
  echo Please send a screenshot of this window.
)

pause
exit /b %EXIT_CODE%
