@echo off
chcp 65001 >nul
cd /d "%~dp0"
set WEB_DIR=web3
set PORT=8790
echo 排字匣 抽籤棚  http://127.0.0.1:%PORT%
python server.py
pause
