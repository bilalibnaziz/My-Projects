@echo off
setlocal
cd /d "%~dp0"
title Skill Photo

set "APP_HTML=%~dp0app\index.html"
set "EDGE_EXE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not exist "%EDGE_EXE%" set "EDGE_EXE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
set "CHROME_EXE=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME_EXE%" set "CHROME_EXE=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME_EXE%" set "CHROME_EXE=%LocalAppData%\Google\Chrome\Application\chrome.exe"

echo Starting Skill Photo v1.0...

if exist "%EDGE_EXE%" (
    start "" "%EDGE_EXE%" --app="file:///%APP_HTML%" --allow-file-access-from-files --window-size=1440,900
    exit /b 0
)

if exist "%CHROME_EXE%" (
    start "" "%CHROME_EXE%" --app="file:///%APP_HTML%" --allow-file-access-from-files --window-size=1440,900
    exit /b 0
)

start "" "%APP_HTML%"
exit /b 0
