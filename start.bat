@echo off
setlocal enabledelayedexpansion
title noon online dashboard
cd /d "%~dp0"

rem --- find the first free port in 7080..7099 (so a busy port won't block startup) ---
set "PORT="
for /l %%p in (7080,1,7099) do (
  if not defined PORT (
    netstat -ano | findstr "LISTENING" | findstr /c:":%%p " >nul 2>&1
    if errorlevel 1 set "PORT=%%p"
  )
)
if not defined PORT (
  echo.
  echo   Could not find a free port in 7080-7099. Close some apps and try again,
  echo   or set one manually:  set PORT=9090 ^&^& node server.js --open
  echo.
  pause
  exit /b 1
)

echo.
echo   Starting noon online dashboard on http://localhost:%PORT%/ ...
echo   (Keep this window open. Close it or press Ctrl+C to stop.)
echo.

node server.js --open

echo.
echo   Server stopped.
pause
