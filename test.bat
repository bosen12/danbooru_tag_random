@echo off
setlocal EnableExtensions
cd /d "%~dp0"
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
where node >nul 2>&1
if errorlevel 1 (
  echo node not found.
  echo Install Node.js and tick "Add to PATH".
  pause
  exit /b 1
)
echo == engine ==
call node scripts\test_engine.mjs
if errorlevel 1 (
  pause
  exit /b 1
)
echo == quiz ==
call node scripts\test_quiz.mjs
if errorlevel 1 (
  pause
  exit /b 1
)
echo == server ==
%PY% scripts\test_server.py
if errorlevel 1 (
  pause
  exit /b 1
)
echo.
echo all ok
