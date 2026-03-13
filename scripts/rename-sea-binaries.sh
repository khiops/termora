#!/usr/bin/env bash
# rename-sea-binaries.sh
#
# Rename dist/sea/nexterm-agent and dist/sea/nexterm-hub with platform suffixes
# matching the GitHub Actions release naming convention:
#   nexterm-{agent|hub}-{os}-{arch}[.exe]
#
# Usage:
#   bash scripts/rename-sea-binaries.sh
#   TARGET_OS=linux TARGET_ARCH=x64 bash scripts/rename-sea-binaries.sh  # override
#
# Environment overrides:
#   TARGET_OS    — linux | darwin | windows  (default: detected from uname)
#   TARGET_ARCH  — x64 | arm64              (default: detected from uname -m)

set -euo pipefail

SEA_DIR="${SEA_DIR:-dist/sea}"

# ── Detect OS ────────────────────────────────────────────────────────────────
if [[ -z "${TARGET_OS:-}" ]]; then
	case "$(uname -s)" in
		Linux*)   TARGET_OS="linux"   ;;
		Darwin*)  TARGET_OS="darwin"  ;;
		MINGW*|MSYS*|CYGWIN*) TARGET_OS="windows" ;;
		*)
			echo "[rename-sea-binaries] ERROR: unsupported OS: $(uname -s)" >&2
			exit 1
			;;
	esac
fi

# ── Detect arch ──────────────────────────────────────────────────────────────
if [[ -z "${TARGET_ARCH:-}" ]]; then
	case "$(uname -m)" in
		x86_64)  TARGET_ARCH="x64"   ;;
		aarch64|arm64) TARGET_ARCH="arm64" ;;
		*)
			echo "[rename-sea-binaries] ERROR: unsupported arch: $(uname -m)" >&2
			exit 1
			;;
	esac
fi

# ── Binary extension ─────────────────────────────────────────────────────────
EXT=""
if [[ "$TARGET_OS" == "windows" ]]; then
	EXT=".exe"
fi

echo "[rename-sea-binaries] platform: ${TARGET_OS}-${TARGET_ARCH}"

# ── Rename helper ─────────────────────────────────────────────────────────────
rename_binary() {
	local name="$1"
	local src="${SEA_DIR}/${name}${EXT}"
	local dst="${SEA_DIR}/${name}-${TARGET_OS}-${TARGET_ARCH}${EXT}"

	if [[ ! -f "$src" ]]; then
		echo "[rename-sea-binaries] WARNING: source not found: ${src}" >&2
		return 0
	fi

	mv "$src" "$dst"
	echo "[rename-sea-binaries] renamed: ${src} → ${dst}"
}

rename_binary "nexterm-agent"
rename_binary "nexterm-hub"

echo "[rename-sea-binaries] done."
