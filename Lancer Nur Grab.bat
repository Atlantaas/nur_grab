@echo off
cd /d "%~dp0"
if not exist node_modules\electron (
  echo Installation deps...
  call npm install
)
start "" cmd /c "npm start"
