@echo off
setlocal
cd /d "%~dp0"

for %%F in ("%~dp0*.exe") do (
  if exist "%%~fF" (
    start "" "%%~fF"
    exit /b 0
  )
)

echo.
echo Portable executable not found.
echo Download it from GitHub Releases, or build it from source.
echo.
pause
exit /b 1
