@echo off
cd /d "%~dp0"
node scripts\start-bige.mjs
if errorlevel 1 pause
