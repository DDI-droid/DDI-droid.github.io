@echo off
rem Start the writer and open it in the browser. Close this window to stop it.
cd /d "%~dp0"
start "" http://localhost:4400
node server.cjs
