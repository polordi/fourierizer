# Fourierizer - install the Standalone app for this user (no admin rights needed).
#
#   .\scripts\install-standalone.ps1             # from build\release (run build.ps1 first)
#   .\scripts\install-standalone.ps1 -Uninstall
#
# Copies Fourierizer.exe to %LOCALAPPDATA%\Programs\Fourierizer and adds "Fourierizer" to the
# Start menu (and the desktop with -Desktop). The app is the same instrument as the VST3: it
# plays through your audio interface and takes MIDI from any keyboard enabled in
# Options > Audio/MIDI Settings. It reopens with the last project; Options > Save current state
# writes a project to a file.

param([switch]$Uninstall, [switch]$Desktop, [ValidateSet("Release", "Debug")][string]$Config = "Release")
$ErrorActionPreference = "Stop"

$repo = Split-Path -Parent $PSScriptRoot
$dest = Join-Path $env:LOCALAPPDATA "Programs\Fourierizer"
$exe = Join-Path $dest "Fourierizer.exe"
$startMenu = Join-Path ([Environment]::GetFolderPath("Programs")) "Fourierizer.lnk"
$desktopLink = Join-Path ([Environment]::GetFolderPath("Desktop")) "Fourierizer.lnk"

if ($Uninstall) {
    foreach ($p in @($startMenu, $desktopLink, $dest)) { if (Test-Path $p) { Remove-Item -Recurse -Force $p } }
    Write-Host "Fourierizer (Standalone) removed." -ForegroundColor Green
    return
}

$built = Join-Path $repo "build\$($Config.ToLower())\plugin\Fourierizer_artefacts\$Config\Standalone\Fourierizer.exe"
if (-not (Test-Path $built)) { throw "Standalone not built yet: $built (run scripts\build.ps1)" }

if (Get-Process -Name Fourierizer -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe }) {
    Write-Warning "Fourierizer is open; close it and run this again to update the installed app."
    return
}
New-Item -ItemType Directory -Force $dest | Out-Null
Copy-Item -Force $built $exe

$shell = New-Object -ComObject WScript.Shell
$links = @($startMenu)
if ($Desktop) { $links += $desktopLink }
foreach ($l in $links) {
    $s = $shell.CreateShortcut($l)
    $s.TargetPath = $exe
    $s.WorkingDirectory = $dest
    $s.Description = "Fourierizer - time-frequency selection synth"
    $s.Save()
}
Write-Host "Fourierizer (Standalone) installed in $dest" -ForegroundColor Green
Write-Host "Start menu: Fourierizer$(if ($Desktop) { ' (and a desktop shortcut)' })"
