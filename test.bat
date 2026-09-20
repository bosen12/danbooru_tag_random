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
echo == scene/place merge contracts ==
call node scripts\test_scene_place_contracts.mjs
if errorlevel 1 (
  pause
  exit /b 1
)
echo == draw optimization contracts ==
call node scripts\test_draw_optimization.mjs
if errorlevel 1 (
  pause
  exit /b 1
)
echo == panel and pin matrix ==
call node scripts\test_panel_pin_matrix.mjs
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
echo == draw invariants ==
call node scripts\audit_draw_invariants.mjs
if errorlevel 1 (
  pause
  exit /b 1
)
echo == clothing reachability ==
call node scripts\test_clothing_reachability.mjs
if errorlevel 1 (
  pause
  exit /b 1
)
echo == lexicon integrity ==
call node scripts\test_lexicon_integrity.mjs
if errorlevel 1 (
  pause
  exit /b 1
)
echo == draw contracts ==
call node scripts\test_draw_contracts.mjs
if errorlevel 1 (
  pause
  exit /b 1
)
echo == client contracts ==
call node scripts\test_client_contracts.mjs
if errorlevel 1 (
  pause
  exit /b 1
)
echo == directional hard rules ==
call node scripts\test_directional_rules.mjs
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
echo == workflow profiles ==
%PY% scripts\test_workflows.py
if errorlevel 1 (
  pause
  exit /b 1
)
echo == server live (fake comfy) ==
%PY% scripts\test_server_live.py
if errorlevel 1 (
  pause
  exit /b 1
)
echo.
echo all ok
