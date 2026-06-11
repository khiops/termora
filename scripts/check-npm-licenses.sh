#!/usr/bin/env bash
# npm dependency license compatibility gate (#78).
# Lists production dependency licenses across the pnpm workspace and fails on
# any license string not in the allowlist. Exact-match on purpose: a new,
# unseen license string must be reviewed by a human before it is allowed.
set -euo pipefail

cd "$(dirname "$0")/.."

# Permissive licenses (and SPDX OR-expressions observed in the tree) compatible
# with AGPL-3.0-only app packages and MIT OR Apache-2.0 libs.
ALLOWED=(
	"MIT"
	"ISC"
	"Apache-2.0"
	"BSD"
	"BSD-2-Clause"
	"BSD-3-Clause"
	"BlueOak-1.0.0"
	"Unlicense"
	"0BSD"
	"CC0-1.0"
	"MIT OR Apache-2.0"
	"Apache-2.0 OR MIT"
	"(MIT OR WTFPL)"
	"(BSD-2-Clause OR MIT OR Apache-2.0)"
)

if ! json=$(pnpm licenses list --prod --json 2>&1); then
	echo "pnpm licenses list failed:" >&2
	echo "$json" >&2
	exit 1
fi

violations=0
while IFS= read -r license; do
	ok=0
	for allowed in "${ALLOWED[@]}"; do
		if [[ "$license" == "$allowed" ]]; then
			ok=1
			break
		fi
	done
	if [[ "$ok" -eq 0 ]]; then
		echo "DISALLOWED license: $license"
		echo "$json" | jq -r --arg l "$license" '.[$l][] | "  - \(.name)@\(.versions | join(", "))"'
		violations=$((violations + 1))
	fi
done < <(echo "$json" | jq -r 'keys[]')

if [[ "$violations" -gt 0 ]]; then
	echo "FAIL: $violations disallowed license(s). Review and extend the allowlist only after a human compatibility check."
	exit 1
fi

echo "OK: all production dependency licenses are in the allowlist."
