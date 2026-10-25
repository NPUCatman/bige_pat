@echo off
setlocal
chcp 65001 >nul
set "PET_LAUNCHER=%~dp0scripts\start-bige.mjs"
if not exist "%PET_LAUNCHER%" set "PET_LAUNCHER=%~dp0bige_pat\scripts\start-bige.mjs"
if not exist "%PET_LAUNCHER%" set "PET_LAUNCHER=%~dp0..\bige_pat\scripts\start-bige.mjs"
if not exist "%PET_LAUNCHER%" (
  echo Cannot find bige_pat\scripts\start-bige.mjs. Keep this script beside the project folders.
  pause
  exit /b 1
)
node "%PET_LAUNCHER%" --original-deepseek %*
if errorlevel 1 pause
