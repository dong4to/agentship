#!/usr/bin/env bash
# Runs /agentship:dev headless on the four representative tasks, each in a fresh clone of the fixture.
# Usage: tests/e2e/run-e2e.sh <fixture-dir> <out-dir>
# Both dirs must be OUTSIDE this repo: with --plugin-dir, Claude Code treats every file under the
# plugin root as sensitive and denies writes there, so a fixture inside the repo cannot be edited.
# Permissions: acceptEdits plus an explicit Bash allowlist (no bypass). git push is denied.
# --setting-sources project,local keeps the developer's user-level plugins and hooks out of the runs.
set -uo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
fixture="$(cd "${1:?fixture dir}" && pwd)"
out="${2:?out dir}"
mkdir -p "$out"; out="$(cd "$out" && pwd)"

declare -A tasks=(
  [small]="applyDiscount in src/cart.js accepts percentages above 100 and returns negative totals; clamp pct to the 0-100 range."
  [medium]="Add order status management: orders get a status (placed, paid, shipped, cancelled) with only valid transitions allowed, a cancelOrder function, and listOrders filtering by status, with tests."
  [large]="Make the store asynchronous and pluggable: define a storage interface with in-memory and JSON-file backends (atomic writes), select the backend via configuration, and migrate cart, orders and all their callers and tests to the async API."
  [high-risk]="Let users with role owner pass isAdmin in src/auth.js."
)

allowed=(Read Edit Write Glob Grep Agent Skill TodoWrite
  "Bash(node *)" "Bash(npm test*)" "Bash(npm run test*)" "Bash(git *)"
  "Bash(ls *)" "Bash(mkdir *)" "Bash(date *)" "Bash(cat *)" "Bash(wc *)")

for name in "${!tasks[@]}"; do
  (
    clone="$out/run-$name"
    rm -rf "$clone" && git clone -q "$fixture" "$clone" && cd "$clone" || exit 1
    git remote remove origin
    start=$(date +%s)
    timeout 2700 claude -p "/agentship:dev ${tasks[$name]}" \
      --plugin-dir "$root" --setting-sources project,local --no-session-persistence \
      --permission-mode acceptEdits --allowedTools "${allowed[@]}" \
      --disallowedTools "Bash(git push*)" "Bash(gh *)" "Bash(npx *)" \
      --output-format json \
      > "$out/$name.json" 2> "$out/$name.err"
    echo "$name exit=$? seconds=$(( $(date +%s) - start ))" >> "$out/summary.txt"
  ) &
done
wait
cat "$out/summary.txt"
