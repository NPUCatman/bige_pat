@echo off
setlocal
chcp 65001 >nul
set "PET_LAUNCHER=%~dp0scripts\stop-bige.mjs"
if not exist "%PET_LAUNCHER%" set "PET_LAUNCHER=%~dp0bige_pat\scripts\stop-bige.mjs"
if not exist "%PET_LAUNCHER%" set "PET_LAUNCHER=%~dp0..\bige_pat\scripts\stop-bige.mjs"
if not exist "%PET_LAUNCHER%" (
  echo Cannot find bige_pat\scripts\stop-bige.mjs. Keep this script beside the project folders.
  pause
  exit /b 1
)
node "%PET_LAUNCHER%" --original-deepseek
if errorlevel 1 pause
