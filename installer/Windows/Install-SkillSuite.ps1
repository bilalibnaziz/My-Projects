# Skill Suite v1.0 PowerShell Automated Installer
param(
    [string]$InstallPath = "$env:LOCALAPPDATA\Programs\SkillSuite"
)

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "       SKILL SUITE v1.0 — POWERSHELL SETUP ENGINE        " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host ""

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$StartMenuDir = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Skill Suite"
$DesktopDir = [Environment]::GetFolderPath('Desktop')

if (-not (Test-Path $InstallPath)) { New-Item -ItemType Directory -Path $InstallPath -Force | Out-Null }
if (-not (Test-Path $StartMenuDir)) { New-Item -ItemType Directory -Path $StartMenuDir -Force | Out-Null }

$apps = @(
    @{ Slug='SkillPhoto'; Name='Skill Photo'; Desc='Pro Photo Editor'; Ext='photo' },
    @{ Slug='SkillVector'; Name='Skill Vector'; Desc='Vector Illustration Suite'; Ext='vector' },
    @{ Slug='SkillMotion'; Name='Skill Motion'; Desc='Video NLE & Motion VFX'; Ext='motion' }
)

$ws = New-Object -ComObject WScript.Shell

foreach ($app in $apps) {
    $src = Join-Path $ScriptDir "$($app.Slug)-v1.0-Windows"
    $dest = Join-Path $InstallPath $app.Slug

    if (Test-Path $src) {
        Write-Host "-> Installing $($app.Name)..." -ForegroundColor Yellow
        Copy-Item -Path "$src\*" -Destination $dest -Recurse -Force
        
        $launcherBat = Join-Path $dest "$($app.Slug).bat"
        $iconPath = Join-Path $dest "icon.ico"

        # Desktop Shortcut
        $dShortcut = $ws.CreateShortcut((Join-Path $DesktopDir "$($app.Name).lnk"))
        $dShortcut.TargetPath = $launcherBat
        $dShortcut.WorkingDirectory = $dest
        $dShortcut.Description = $app.Desc
        if (Test-Path $iconPath) { $dShortcut.IconLocation = "$iconPath,0" }
        $dShortcut.Save()

        # Start Menu Shortcut
        $sShortcut = $ws.CreateShortcut((Join-Path $StartMenuDir "$($app.Name).lnk"))
        $sShortcut.TargetPath = $launcherBat
        $sShortcut.WorkingDirectory = $dest
        $sShortcut.Description = $app.Desc
        if (Test-Path $iconPath) { $sShortcut.IconLocation = "$iconPath,0" }
        $sShortcut.Save()

        Write-Host "   ✓ Installed and shortcuts registered." -ForegroundColor Green
    }
}

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  ✓ SUCCESS: All 3 Skill Suite applications installed!    " -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Cyan
