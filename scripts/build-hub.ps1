#Requires -Version 7.0
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Split-Path -Parent $ScriptDir

$arch = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "aarch64" } else { "x86_64" }
$env:NEXTERM_TARGET_TRIPLE ??= "$arch-pc-windows-msvc"
$env:NEXTERM_DIST_DIR ??= "$Root\dist\sea"
if (-not $env:NEXTERM_BUILD_HASH) {
    $env:NEXTERM_BUILD_HASH = (git -C $Root rev-parse --short=8 HEAD).Trim()
}
$env:NEXTERM_SKIP_WEB ??= "false"

Write-Host "🔨 Building hub SEA (triple: $env:NEXTERM_TARGET_TRIPLE)..." -ForegroundColor Cyan

Set-Location $Root
pnpm -F @nexterm/shared build

if ($env:NEXTERM_SKIP_WEB -ne "true") {
    Write-Host "  → Building web UI first..." -ForegroundColor DarkGray
    & "$ScriptDir\build-web.ps1"
}

pnpm run package:sea-hub
if ($LASTEXITCODE -ne 0) { throw "package:sea-hub failed" }

$binary = "$env:NEXTERM_DIST_DIR\nexterm-hub.exe"
if (Test-Path $binary) {
    $size = [math]::Round((Get-Item $binary).Length / 1MB, 1)
    Write-Host "✅ Hub SEA built → $binary (${size}MB)" -ForegroundColor Green
}
