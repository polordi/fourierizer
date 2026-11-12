# Fourierizer - configure and build on Windows.
#
#   .\scripts\build.ps1                 # Release build (default)
#   .\scripts\build.ps1 -Config Debug   # Debug build
#
# It loads the Visual Studio developer environment (so cl.exe, the Windows SDK and Ninja are
# on PATH), configures CMake into build/<config> and builds every target. Built VST3 plugins
# are copied to %LOCALAPPDATA%\Programs\Common\VST3.

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

$buildDir = Join-Path $repo "build\$($Config.ToLower())"
# Native tools (git, cmake) write progress to stderr; in Windows PowerShell 5.1 that must not
# count as a failure. Judge them by their exit code instead.
$ErrorActionPreference = "Continue"
cmake -S $repo -B $buildDir -G Ninja "-DCMAKE_BUILD_TYPE=$Config"
if ($LASTEXITCODE -ne 0) { throw "CMake configure failed" }
cmake --build $buildDir --parallel
if ($LASTEXITCODE -ne 0) { throw "Build failed" }
$ErrorActionPreference = "Stop"

Write-Host "`nBuilt in $buildDir" -ForegroundColor Green
Write-Host "VST3 copied to $env:LOCALAPPDATA\Programs\Common\VST3"
