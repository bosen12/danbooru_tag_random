@echo off
chcp 65001 >nul
cd /d "%~dp0"
set WEB_DIR=web1
set PORT=8788
echo 排字匣 暗房  http://127.0.0.1:%PORT%
python server.py
pause
