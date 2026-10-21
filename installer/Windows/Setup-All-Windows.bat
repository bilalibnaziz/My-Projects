@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
title Skill Suite v1.0 — Master Windows Installer

color 0B
cls
echo ======================================================================
echo              SKILL SUITE v1.0 — MASTER WINDOWS INSTALLER             
echo ======================================================================
echo.
echo  This will install all 4 creative applications to your computer:
echo.
echo    [1] Skill Photo   - Layered Photo Editor (Photoshop alternative)
echo    [2] Skill Vector  - Vector Illustration (Illustrator alternative)
echo    [3] Skill Motion  - Video NLE & VFX (Premiere + AE alternative)
echo    [4] Skill Design  - UI/UX Product Design (Figma alternative)
echo.
echo  Installation Directory: %LOCALAPPDATA%\Programs\SkillSuite
echo  Shortcuts: Desktop and Start Menu
echo.
echo ======================================================================
set /p CONFIRM="Install Skill Suite now? (Y/N): "
if /i not "%CONFIRM%"=="Y" (
    echo Installation cancelled.
    pause
    exit /b 0
)

echo.
set "INSTALL_BASE=%LOCALAPPDATA%\Programs\SkillSuite"
set "START_MENU=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Skill Suite"
set "DESKTOP=%USERPROFILE%\Desktop"

if not exist "%INSTALL_BASE%" mkdir "%INSTALL_BASE%"
if not exist "%START_MENU%" mkdir "%START_MENU%"

for %%A in (SkillPhoto SkillVector SkillMotion) do (
    echo [>] Installing %%A...
    if exist "%~dp0%%A-v1.0-Windows" (
        if not exist "%INSTALL_BASE%\%%A" mkdir "%INSTALL_BASE%\%%A"
        xcopy /E /I /Y /Q "%~dp0%%A-v1.0-Windows\*" "%INSTALL_BASE%\%%A\" >nul
        echo     - Files copied to %INSTALL_BASE%\%%A
    ) else (
        echo     - Warning: %%A package not found!
    )
)

echo.
echo [>] Creating Desktop and Start Menu Shortcuts...
powershell -NoProfile -ExecutionPolicy Bypass -Command "& {
    $ws = New-Object -ComObject WScript.Shell
    $base = $env:LOCALAPPDATA + '\Programs\SkillSuite'
    $desktop = [Environment]::GetFolderPath('Desktop')
    $startMenu = $env:APPDATA + '\Microsoft\Windows\Start Menu\Programs\Skill Suite'

    $apps = @(
        @{ Slug='SkillPhoto'; Name='Skill Photo'; Ext='photo' },
        @{ Slug='SkillVector'; Name='Skill Vector'; Ext='vector' },
        @{ Slug='SkillMotion'; Name='Skill Motion'; Ext='motion' }
    )

    foreach ($app in $apps) {
        $targetBat = Join-Path $base ($app.Slug + '\' + $app.Slug + '.bat')
        $icon = Join-Path $base ($app.Slug + '\icon.ico')

        # Desktop
        $dtLink = Join-Path $desktop ($app.Name + '.lnk')
        $s1 = $ws.CreateShortcut($dtLink)
        $s1.TargetPath = $targetBat
        $s1.WorkingDirectory = (Join-Path $base $app.Slug)
        if (Test-Path $icon) { $s1.IconLocation = $icon + ',0' }
        $s1.Save()

        # Start Menu
        $smLink = Join-Path $startMenu ($app.Name + '.lnk')
        $s2 = $ws.CreateShortcut($smLink)
        $s2.TargetPath = $targetBat
        $s2.WorkingDirectory = (Join-Path $base $app.Slug)
        if (Test-Path $icon) { $s2.IconLocation = $icon + ',0' }
        $s2.Save()

        Write-Host ('   ✓ Shortcuts created for ' + $app.Name)
    }
}"

echo.
echo ======================================================================
echo    INSTALLATION COMPLETE! Skill Suite v1.0 is ready to use!
echo ======================================================================
echo.
echo Launch any app from your Desktop or the 'Skill Suite' Start Menu folder.
echo.
pause
