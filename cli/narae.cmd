@echo off
setlocal
set ELECTRON_RUN_AS_NODE=1
if exist "%~dp0runtime\narae-engine.exe" (
  "%~dp0runtime\narae-engine.exe" "%~dp0cli\narae.mjs" %*
) else (
  "%~dp0runtime\narae-movie-maker.exe" "%~dp0cli\narae.mjs" %*
)
