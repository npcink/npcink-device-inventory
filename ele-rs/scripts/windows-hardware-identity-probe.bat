@echo off
setlocal

set "PS_SCRIPT=%~dp0windows-hardware-identity-probe.ps1"
if not exist "%PS_SCRIPT%" (
  echo Keep this BAT file and windows-hardware-identity-probe.ps1 in the same folder.
  pause
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PS_SCRIPT%" -PromptForAssetNumber
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" echo Probe failed with exit code %EXIT_CODE%.
pause
exit /b %EXIT_CODE%
