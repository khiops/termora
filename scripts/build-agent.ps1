#Requires -Version 7.0
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Split-Path -Parent $ScriptDir

$arch = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "aarch64" } else { "x86_64" }
$env:TERMORA_TARGET_TRIPLE ??= "$arch-pc-windows-msvc"
$env:TERMORA_DIST_DIR ??= "$Root\dist\sea"
$env:TERMORA_CARGO_TARGET_DIR ??= "$Root\target"

Write-Host "🔨 Building Rust agent (triple: $env:TERMORA_TARGET_TRIPLE)..." -ForegroundColor Cyan

New-Item -ItemType Directory -Force -Path $env:TERMORA_DIST_DIR | Out-Null
Set-Location $Root
# Note: native build only (no --target). Cross-compilation would need --target.
# TERMORA_TARGET_TRIPLE is used for artifact naming and CI metadata.
cargo build -p termora-agent --release --target-dir $env:TERMORA_CARGO_TARGET_DIR
if ($LASTEXITCODE -ne 0) { throw "cargo build failed" }

$binary = "$env:TERMORA_CARGO_TARGET_DIR\release\termora-agent.exe"
if (-not (Test-Path $binary)) { throw "Binary not found at $binary" }
Copy-Item $binary "$env:TERMORA_DIST_DIR\termora-agent.exe" -Force

$size = [math]::Round((Get-Item "$env:TERMORA_DIST_DIR\termora-agent.exe").Length / 1MB, 1)
Write-Host "✅ Rust agent built → $env:TERMORA_DIST_DIR\termora-agent.exe (${size}MB)" -ForegroundColor Green
