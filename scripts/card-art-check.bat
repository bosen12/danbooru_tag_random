@echo off
rem Card art check, called by the launchers (start.bat, start-web6.bat, start-zipu.bat).
rem If card illustrations are missing or their prompt changed, and ComfyUI is running,
rem bake them in a minimized window. No menu. The page still opens right away.
rem Needs PY (set by the launcher). Pass "extras" to also check the zipu props/customers.
rem Skip with: set NO_CARD_BAKE=1, or create .no-card-bake in the project root.
rem Console text is ASCII on purpose: cmd's code page is not UTF-8.
if not defined PY set "PY=python"
rem First choice: download the published all-ages set (git clone does not include the art).
rem Runs in its own window so the page opens right away; skip with: set NO_CARD_FETCH=1
if defined NO_CARD_FETCH goto bakecheck
%PY% "%~dp0fetch_card_art.py" --check
if not errorlevel 3 goto bakecheck
echo Card illustrations are missing; downloading them in a minimized window "card art download".
echo The page opens now with placeholder cards; reload it when the download says Done.
set "CARD_FETCH_STARTED=1"
start "card art download" /min "%~dp0fetch-cards-window.bat"
exit /b 0

:bakecheck
if defined NO_CARD_BAKE exit /b 0
if exist "%~dp0..\.no-card-bake" exit /b 0
set "CA_EXTRAS=%~1"
set "CA_XRC=0"
rem All ratings. --rating general used to hide the explicit cards, so new sex tags never baked.
%PY% "%~dp0bake_card_art.py" --status
set "CA_RC=%errorlevel%"
if /i not "%CA_EXTRAS%"=="extras" goto decide
%PY% "%~dp0bake_card_art.py" --status --extras
set "CA_XRC=%errorlevel%"

:decide
if "%CA_RC%%CA_XRC%"=="00" exit /b 0
if "%CA_RC%"=="12" exit /b 0
if "%CA_XRC%"=="12" exit /b 0
if "%CA_RC%"=="11" goto offline
if "%CA_XRC%"=="11" if not "%CA_RC%"=="10" goto offline
if not "%CA_RC%"=="10" if not "%CA_XRC%"=="10" exit /b 0

echo.
echo Card illustrations are missing or out of date. Baking them with ComfyUI.
echo The page opens right away. Reload it to see new cards.
echo Close the "card art bake" window to stop. Finished cards are kept.
start "card art bake" /min "%~dp0bake-cards-window.bat" all %CA_EXTRAS%
echo Baking started in a minimized window "card art bake".
exit /b 0

:offline
echo Card illustrations are missing and ComfyUI is not running.
echo Cards show a placeholder glyph for now. Start ComfyUI and relaunch to bake them.
exit /b 0
