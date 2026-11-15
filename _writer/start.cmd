@echo off
rem Start the writer and open it in the browser. Close this window to stop it.
cd /d "%~dp0"
if not defined WRITER_SITE (
  if exist "%~dp0..\_config.yml" set "WRITER_SITE=%~dp0.."
  if not defined WRITER_SITE if exist "%~dp0..\..\anshul-site\_config.yml" set "WRITER_SITE=%~dp0..\..\anshul-site"
)
start "" http://localhost:4400
node dev.cjs
