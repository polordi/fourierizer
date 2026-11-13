# Fourierizer - build and test only the C++ engine (core/), without JUCE. Fast to iterate.
#
#   .\scripts\test-core.ps1           # build (Release), run the golden tests
#   .\scripts\test-core.ps1 -Bench    # ... and the render benchmark

param([switch]$Bench, [ValidateSet("Release", "Debug")][string]$Config = "Release")
$ErrorActionPreference = "Stop"

$repo = Split-Path -Parent $PSScriptRoot
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$vs = & $vswhere -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -latest -property installationPath
if (-not $vs) { throw "MSVC not found. Run scripts\setup-windows.ps1 first." }
$env:Path = "$(Split-Path $vswhere);$env:Path"
Import-Module "$vs\Common7\Tools\Microsoft.VisualStudio.DevShell.dll"
Enter-VsDevShell -VsInstallPath $vs -SkipAutomaticLocation -DevCmdArguments "-arch=x64 -host_arch=x64" | Out-Null

$build = Join-Path $repo "build\core-$($Config.ToLower())"
$ErrorActionPreference = "Continue"
cmake -S (Join-Path $repo "core") -B $build -G Ninja "-DCMAKE_BUILD_TYPE=$Config"
if ($LASTEXITCODE -ne 0) { throw "CMake configure failed" }
cmake --build $build --parallel
if ($LASTEXITCODE -ne 0) { throw "Build failed" }
& "$build\fourierizer-core-tests.exe"
if ($LASTEXITCODE -ne 0) { throw "Golden tests failed" }
if ($Bench) { & "$build\fourierizer-core-bench.exe" }
