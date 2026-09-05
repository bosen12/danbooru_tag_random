@echo off
chcp 65001 >nul
cd /d "%~dp0"
set WEB_DIR=web2
set PORT=8789
echo 排字匣 活字樓  http://127.0.0.1:%PORT%
python server.py
pause
