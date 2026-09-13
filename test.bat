@echo off
setlocal EnableExtensions
cd /d "%~dp0"
set "PYTHONUTF8=1"
set "PY="
python -c "import sys; raise SystemExit(sys.version_info.major != 3)" >nul 2>&1
if not errorlevel 1 set "PY=python"
if not defined PY (
  py -3 -c "import sys; raise SystemExit(sys.version_info.major != 3)" >nul 2>&1
  if not errorlevel 1 set "PY=py -3"
)
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
echo == Danbooru verifier ==
call node scripts\test_verify_danbooru_tags.mjs
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
echo == prompt audit ==
call node scripts\test_shadow_generation.mjs
if errorlevel 1 (
  pause
  exit /b 1
)
call node scripts\test_validate_gold.mjs
if errorlevel 1 (
  pause
  exit /b 1
)
call node scripts\test_eval_shadow.mjs
if errorlevel 1 (
  pause
  exit /b 1
)
call node scripts\prompt_audit\validate_gold.mjs scripts\prompt_audit\r42.json scripts\prompt_audit\r42_gold.json
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
