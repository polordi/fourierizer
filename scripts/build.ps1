# Fourierizer - configure and build on Windows.
#
#   .\scripts\build.ps1                 # Release build (default)
#   .\scripts\build.ps1 -Config Debug   # Debug build
#
# It loads the Visual Studio developer environment (so cl.exe, the Windows SDK and Ninja are
# on PATH), configures CMake into build/<config> and builds every target. Built VST3 plugins
# are copied to %LOCALAPPDATA%\Programs\Common\VST3 and the Standalone app is installed
# (scripts\install-standalone.ps1).

param([ValidateSet("Release", "Debug")][string]$Config = "Release")
$ErrorActionPreference = "Stop"

$repo = Split-Path -Parent $PSScriptRoot
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$vs = & $vswhere -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -latest -property installationPath
if (-not $vs) { throw "MSVC not found. Run scripts\setup-windows.ps1 first." }

# Enter the x64 developer shell for this process only (it calls vswhere by name, so put it on PATH).
$env:Path = "$(Split-Path $vswhere);$env:Path"
Import-Module "$vs\Common7\Tools\Microsoft.VisualStudio.DevShell.dll"
Enter-VsDevShell -VsInstallPath $vs -SkipAutomaticLocation -DevCmdArguments "-arch=x64 -host_arch=x64" | Out-Null

# Node.js (for the web UI) may have been installed after this shell started: reload PATH.
$env:Path = "$env:Path;" + [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")

$buildDir = Join-Path $repo "build\$($Config.ToLower())"

# An installed release (installer) lives in Common Files\VST3: then do not copy dev builds next to
# it (FL Studio would list the plugin twice) and do not install the dev app.
$released = Test-Path "$env:CommonProgramFiles\VST3\Fourierizer.vst3"
$copy = if ($released) { "OFF" } else { "ON" }
# Native tools (git, cmake) write progress to stderr; in Windows PowerShell 5.1 that must not
# count as a failure. Judge them by their exit code instead.
$ErrorActionPreference = "Continue"
cmake -S $repo -B $buildDir -G Ninja "-DCMAKE_BUILD_TYPE=$Config" "-DFZ_COPY_PLUGINS=$copy"
if ($LASTEXITCODE -ne 0) { throw "CMake configure failed" }
cmake --build $buildDir --parallel
if ($LASTEXITCODE -ne 0) { throw "Build failed" }
$ErrorActionPreference = "Stop"

Write-Host "`nBuilt in $buildDir" -ForegroundColor Green
if ($released) {
    Write-Host "An installed Fourierizer was found in Common Files\VST3: the dev build was NOT copied or installed." -ForegroundColor Yellow
    Write-Host "Test it from build\$($Config.ToLower())\plugin\Fourierizer_artefacts (or uninstall the release to go back)."
} else {
    Write-Host "VST3 copied to $env:LOCALAPPDATA\Programs\Common\VST3"
    # The Standalone app, for using Fourierizer without a DAW (Start menu > Fourierizer).
    if ($Config -eq "Release") { & (Join-Path $PSScriptRoot "install-standalone.ps1") }
}
