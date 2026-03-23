#Requires -Version 7.0
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Split-Path -Parent $ScriptDir
if (-not $env:NEXTERM_BUILD_HASH) {
    $env:NEXTERM_BUILD_HASH = (git -C $Root rev-parse --short=8 HEAD).Trim()
}

Write-Host "🔨 Building web UI (hash: $env:NEXTERM_BUILD_HASH)..." -ForegroundColor Cyan

Set-Location $Root
pnpm -F @nexterm/shared build
# NEXTERM_BUILD_HASH is already set in process env — pnpm inherits it
pnpm -F @nexterm/web build
node scripts/embed-web.js

Write-Host "✅ Web built → packages\hub\static\" -ForegroundColor Green
