@echo off
chcp 65001 >nul
cd /d "%~dp0"
set WEB_DIR=web
set PORT=8787
echo 排字匣 原版  http://127.0.0.1:%PORT%
python server.py
pause
