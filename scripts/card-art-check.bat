@echo off
rem Card art check, called by the launchers (start.bat, start-web6.bat, start-zipu.bat).
rem If card illustrations are missing and ComfyUI is running, offer to bake them in a
rem separate window. The page still opens right away; cards fill in as they finish.
rem Needs PY (set by the launcher). Pass "extras" to also check the zipu props/customers.
rem Skip with: set NO_CARD_BAKE=1, or answer 4 once (creates .no-card-bake).
rem Console text is ASCII on purpose: cmd's code page is not UTF-8.
if defined NO_CARD_BAKE exit /b 0
if exist "%~dp0..\.no-card-bake" exit /b 0
if not defined PY set "PY=python"
set "CA_EXTRAS=%~1"
set "CA_XRC=0"
%PY% "%~dp0bake_card_art.py" --status --rating general
set "CA_RC=%errorlevel%"
if /i not "%CA_EXTRAS%"=="extras" goto decide
%PY% "%~dp0bake_card_art.py" --status --extras
set "CA_XRC=%errorlevel%"

:decide
if "%CA_RC%%CA_XRC%"=="00" exit /b 0
if "%CA_RC%"=="12" exit /b 0
if "%CA_XRC%"=="12" exit /b 0
if "%CA_RC%"=="11" goto offline
if "%CA_XRC%"=="11" goto offline
if not "%CA_RC%"=="10" if not "%CA_XRC%"=="10" exit /b 0

echo.
echo Some card illustrations are missing. Bake them now with your local ComfyUI?
echo It runs in its own window, so the page opens right away and cards appear as they finish.
echo Already baked cards are kept, so you can close that window and continue another time.
echo   1 = all-ages cards only  (recommended, about 1060 images)
echo   2 = every rating         (about 1370 images, includes sensitive and explicit)
echo   3 = not now
echo   4 = never ask again
choice /c 1234 /t 20 /d 1 /n /m "Choose 1-4 (picks 1 in 20 seconds): "
set "CA_PICK=%errorlevel%"
if "%CA_PICK%"=="4" (
  type nul > "%~dp0..\.no-card-bake"
  echo OK, will not ask again. Delete .no-card-bake to be asked again.
  exit /b 0
)
if "%CA_PICK%"=="3" exit /b 0
set "CA_SCOPE=general"
if "%CA_PICK%"=="2" set "CA_SCOPE=all"
start "card art bake" /min "%~dp0bake-cards-window.bat" %CA_SCOPE% %CA_EXTRAS%
echo Baking started in a minimized window "card art bake".
exit /b 0

:offline
echo Card illustrations are missing and ComfyUI is not running.
echo Cards show a placeholder glyph for now. Start ComfyUI and relaunch to bake them.
exit /b 0
