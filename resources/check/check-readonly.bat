@echo off
chcp 65001 >nul
setlocal EnableExtensions DisableDelayedExpansion
set "BX_ROOT=%~1"
if "%BX_ROOT%"=="" set "BX_ROOT=%~dp0"
if "%BX_ROOT:~-1%"=="\" set "BX_ROOT=%BX_ROOT:~0,-1%"
set "BX_HELPER=%~dp0check-readonly.ps1"
if not exist "%BX_HELPER%" set "BX_HELPER=%BX_ROOT%\check-readonly.ps1"
if not exist "%BX_HELPER%" set "BX_HELPER=%BX_ROOT%\scripts\check-readonly.ps1"
if not exist "%BX_HELPER%" (
  echo [FAIL] check-readonly.ps1 not found. Keep it next to this BAT.
  if /i not "%~2"=="--no-pause" pause
  exit /b 1
)
powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%BX_HELPER%" -Root "%BX_ROOT%"
set "BX_EXIT=%ERRORLEVEL%"
if /i not "%~2"=="--no-pause" pause
exit /b %BX_EXIT%
