@echo off
setlocal
cd /d "%~dp0"
title Skill Photo Installer

set "TARGET_DIR=%LOCALAPPDATA%\Programs\SkillSuite\SkillPhoto"
echo ========================================================
echo       Skill Photo v1.0 Windows Setup
echo ========================================================
echo.
echo Installing to: %TARGET_DIR%

if not exist "%TARGET_DIR%" mkdir "%TARGET_DIR%"
xcopy /E /I /Y "%~dp0*" "%TARGET_DIR%\" >nul

echo Creating Desktop shortcut...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut([System.IO.Path]::Combine([Environment]::GetFolderPath('Desktop'), 'Skill Photo.lnk')); $s.TargetPath = '%TARGET_DIR%\SkillPhoto.bat'; $s.WorkingDirectory = '%TARGET_DIR%'; if (Test-Path '%TARGET_DIR%\icon.ico') { $s.IconLocation = '%TARGET_DIR%\icon.ico,0' }; $s.Save()"

echo Creating Start Menu shortcut...
set "START_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Skill Suite"
if not exist "%START_DIR%" mkdir "%START_DIR%"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut([System.IO.Path]::Combine('%START_DIR%', 'Skill Photo.lnk')); $s.TargetPath = '%TARGET_DIR%\SkillPhoto.bat'; $s.WorkingDirectory = '%TARGET_DIR%'; if (Test-Path '%TARGET_DIR%\icon.ico') { $s.IconLocation = '%TARGET_DIR%\icon.ico,0' }; $s.Save()"

echo.
echo [OK] Skill Photo v1.0 installed successfully!
echo You can launch it from your Desktop or Start Menu.
pause
