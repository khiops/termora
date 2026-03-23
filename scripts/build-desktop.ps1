#Requires -Version 7.0
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Split-Path -Parent $ScriptDir

$arch = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "aarch64" } else { "x86_64" }
$env:NEXTERM_TARGET_TRIPLE ??= "$arch-pc-windows-msvc"
$env:NEXTERM_DIST_DIR ??= "$Root\dist\sea"
$tauriDir = "$Root\packages\clients\desktop\src-tauri"

Write-Host "🔨 Building desktop (triple: $env:NEXTERM_TARGET_TRIPLE)..." -ForegroundColor Cyan
Write-Host ""

# Step 1: Web
Write-Host "━━━ [1/4] Web UI ━━━" -ForegroundColor Yellow
& "$ScriptDir\build-web.ps1"
Write-Host ""

# Step 2: Agent
Write-Host "━━━ [2/4] Rust Agent ━━━" -ForegroundColor Yellow
& "$ScriptDir\build-agent.ps1"
Write-Host ""

# Step 3: Hub (skip web, already built)
Write-Host "━━━ [3/4] Hub SEA ━━━" -ForegroundColor Yellow
$env:NEXTERM_SKIP_WEB = "true"
& "$ScriptDir\build-hub.ps1"
$env:NEXTERM_SKIP_WEB = $null
Write-Host ""

# Step 4: Place sidecars and build Tauri
Write-Host "━━━ [4/4] Tauri Desktop ━━━" -ForegroundColor Yellow

$triple = $env:NEXTERM_TARGET_TRIPLE
Copy-Item "$env:NEXTERM_DIST_DIR\nexterm-agent.exe" "$tauriDir\nexterm-agent-$triple.exe" -Force
Copy-Item "$env:NEXTERM_DIST_DIR\nexterm-hub.exe" "$tauriDir\nexterm-hub-$triple.exe" -Force

Write-Host "  → Sidecars placed in src-tauri/" -ForegroundColor DarkGray

Set-Location $Root
pnpm -F @nexterm/desktop tauri build --config '{\"build\":{\"beforeBuildCommand\":\"\"}}'
if ($LASTEXITCODE -ne 0) { throw "tauri build failed" }

Write-Host ""
Write-Host "✅ Desktop built for $triple" -ForegroundColor Green
