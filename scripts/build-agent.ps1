#Requires -Version 7.0
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Split-Path -Parent $ScriptDir

$arch = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "aarch64" } else { "x86_64" }
$env:NEXTERM_TARGET_TRIPLE ??= "$arch-pc-windows-msvc"
$env:NEXTERM_DIST_DIR ??= "$Root\dist\sea"
$env:NEXTERM_CARGO_TARGET_DIR ??= "$Root\target"

Write-Host "🔨 Building Rust agent (triple: $env:NEXTERM_TARGET_TRIPLE)..." -ForegroundColor Cyan

New-Item -ItemType Directory -Force -Path $env:NEXTERM_DIST_DIR | Out-Null
Set-Location $Root
# Note: native build only (no --target). Cross-compilation would need --target.
# NEXTERM_TARGET_TRIPLE is used for artifact naming and CI metadata.
cargo build -p nexterm-agent --release --target-dir $env:NEXTERM_CARGO_TARGET_DIR
if ($LASTEXITCODE -ne 0) { throw "cargo build failed" }

$binary = "$env:NEXTERM_CARGO_TARGET_DIR\release\nexterm-agent.exe"
if (-not (Test-Path $binary)) { throw "Binary not found at $binary" }
Copy-Item $binary "$env:NEXTERM_DIST_DIR\nexterm-agent.exe" -Force

$size = [math]::Round((Get-Item "$env:NEXTERM_DIST_DIR\nexterm-agent.exe").Length / 1MB, 1)
Write-Host "✅ Rust agent built → $env:NEXTERM_DIST_DIR\nexterm-agent.exe (${size}MB)" -ForegroundColor Green
