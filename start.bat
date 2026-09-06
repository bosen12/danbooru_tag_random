@echo off
setlocal EnableExtensions
cd /d "%~dp0"
set "WEB_DIR=web"
set "PORT=8787"
set "PYTHONUTF8=1"
set "PY="
where py >nul 2>&1 && set "PY=py -3"
if not defined PY where python >nul 2>&1 && set "PY=python"
if not defined PY (
  echo Python 3 not found.
  echo Install Python and tick "Add python.exe to PATH".
  pause
  exit /b 1
)
echo pai-zi-xia  original
echo http://127.0.0.1:%PORT%/
start "" "http://127.0.0.1:%PORT%/"
%PY% server.py
if errorlevel 1 pause
