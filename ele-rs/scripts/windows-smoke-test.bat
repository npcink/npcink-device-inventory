@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "PS_SCRIPT=%SCRIPT_DIR%windows-smoke-test.ps1"

if not exist "%PS_SCRIPT%" (
  echo Missing %PS_SCRIPT%
  exit /b 1
)

rem Preserve the caller's privileges. Run separately as administrator for comparison.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PS_SCRIPT%" %*
set EXIT_CODE=%ERRORLEVEL%

echo.
echo Windows smoke test exited with code %EXIT_CODE%.
if not "%NPCINK_NO_PAUSE%"=="1" pause
exit /b %EXIT_CODE%
