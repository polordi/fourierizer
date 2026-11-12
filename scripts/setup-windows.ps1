# Fourierizer - one-time Windows toolchain setup
#
# Run ONCE in a PowerShell window opened "As Administrator":
#   Set-ExecutionPolicy -Scope Process Bypass
#   .\scripts\setup-windows.ps1
#
# What it installs (all official packages via winget / NuGet):
#   1. Visual Studio 2022 Build Tools (C++ workload) - the MSVC compiler + Windows SDK
#   2. CMake   - build-system generator
#   3. Ninja   - fast build runner used by CMake
#   4. Node.js LTS - JavaScript tooling for the web UI (TypeScript, Vite)
#   5. Microsoft.Web.WebView2 SDK (NuGet) - headers JUCE needs to embed the web UI
#
# Safe to re-run: already-installed packages are skipped.

$ErrorActionPreference = "Stop"
$common = @("--exact", "--accept-package-agreements", "--accept-source-agreements", "--silent")

function Install-WingetPackage([string]$id, [string[]]$extra = @()) {
    Write-Host "`n==> $id" -ForegroundColor Cyan
    $listed = winget list --id $id --exact 2>$null | Select-String -SimpleMatch $id
    if ($listed) { Write-Host "    already installed, skipping"; return }
    winget install --id $id @common @extra
    if ($LASTEXITCODE -ne 0) { throw "winget failed for $id (exit $LASTEXITCODE)" }
}

# 1. MSVC compiler + Windows SDK (large download, ~5-8 GB, can take 10-30 min)
Install-WingetPackage "Microsoft.VisualStudio.2022.BuildTools" @(
    "--override", "--passive --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
)

# 2-4. Build tools and JS runtime
Install-WingetPackage "Kitware.CMake"
Install-WingetPackage "Ninja-build.Ninja"
Install-WingetPackage "OpenJS.NodeJS.LTS"

# 5. WebView2 SDK, version documented by JUCE for static linking
Write-Host "`n==> Microsoft.Web.WebView2 (NuGet)" -ForegroundColor Cyan
if (-not (Get-PackageProvider -ListAvailable -Name NuGet -ErrorAction SilentlyContinue)) {
    Install-PackageProvider -Name NuGet -MinimumVersion 2.8.5.201 -Force | Out-Null
}
if (-not (Get-PackageSource -Name nugetRepository -ErrorAction SilentlyContinue)) {
    Register-PackageSource -ProviderName NuGet -Name nugetRepository -Location https://www.nuget.org/api/v2 -Force | Out-Null
}
if (-not (Get-Package -Name Microsoft.Web.WebView2 -RequiredVersion 1.0.1901.177 -ErrorAction SilentlyContinue)) {
    Install-Package Microsoft.Web.WebView2 -Scope CurrentUser -RequiredVersion 1.0.1901.177 -Source nugetRepository -Force | Out-Null
} else { Write-Host "    already installed, skipping" }

Write-Host "`nDone. Close this window and open a NEW terminal so PATH changes take effect." -ForegroundColor Green
Write-Host "Then run:  cmake --version ; ninja --version ; node --version"
