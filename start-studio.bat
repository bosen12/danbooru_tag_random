@echo off
setlocal EnableExtensions
cd /d "%~dp0"
set "WEB_DIR=web4"
set "PORT=8793"
python server.py
