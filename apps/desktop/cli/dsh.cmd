@echo off
setlocal DisableDelayedExpansion
set "ELECTRON_RUN_AS_NODE=1"
rem An inherited DSH_HOME names a DeepSeek Harness home; this command uses the Kito Harness one.
set "DSH_HOME=%USERPROFILE%\.kito-harness"
if defined KITO_HARNESS_HOME set "DSH_HOME=%KITO_HARNESS_HOME%"
"%~dp0..\..\..\..\Kito Harness.exe" --expose-internals "%~dp0..\..\..\app.asar\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\cli.js" %*
exit /b %errorlevel%
