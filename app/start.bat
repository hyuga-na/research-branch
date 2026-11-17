@echo off
rem Research Branch launcher: double-click to start (Ctrl+C or close window to stop)
cd /d "%~dp0"
if not exist node_modules (
  echo Installing dependencies...
  call npm install || goto :fail
)
echo Building...
call npm run build || goto :fail
start "" cmd /c "timeout /t 2 >NUL & start http://localhost:4173"
node server.mjs
goto :eof
:fail
echo Failed to start. See the messages above.
pause
