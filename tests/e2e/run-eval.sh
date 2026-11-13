#!/usr/bin/env bash
# Profile evaluation (plan 12.5): runs the same fixed task set under two or more model profiles, each task in
# a fresh clone of the fixture, then compares the runs with `cli.ts compare`.
# Usage: tests/e2e/run-eval.sh <fixture-dir> <out-dir> [profile ...]   (default: balanced economy)
# Costs real model usage: every task runs once per profile.
set -uo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
fixture="$(cd "${1:?fixture dir}" && pwd)"
out="${2:?out dir}"; mkdir -p "$out"; out="$(cd "$out" && pwd)"
shift 2
profiles=("$@")
[ $# -eq 0 ] && profiles=(balanced economy)

# Fixed task set: small bug, medium feature, architectural change, security case, concurrency case, known regression.
declare -A tasks=(
  [small-bug]="applyDiscount in src/cart.js accepts percentages above 100 and returns negative totals; clamp pct to the 0-100 range."
  [medium-feature]="Add order status management: orders get a status (placed, paid, shipped, cancelled) with only valid transitions allowed, a cancelOrder function, and listOrders filtering by status, with tests."
  [architecture]="Make the store asynchronous and pluggable: define a storage interface with in-memory and JSON-file backends (atomic writes), select the backend via configuration, and migrate cart, orders and all their callers and tests to the async API."
  [security]="Let users with role owner pass isAdmin in src/auth.js."
  [concurrency]="placeOrder in src/orders.js silently overwrites an existing order when called twice with the same orderId (for example a retried request); make it idempotent: a repeated call returns the existing order unchanged."
  [regression]="addItem in src/cart.js accepts a qty of 0 or a negative qty, which breaks cartTotal; reject them with an error, without changing the behaviour for valid quantities."
)

allowed=(Read Edit Write Glob Grep Agent Skill TodoWrite "Bash(node *)" "Bash(npm test*)" "Bash(npm run *)" "Bash(git diff*)" "Bash(git status*)")
json() { node -e "let s='';process.stdin.on('data',c=>s+=c).on('end',()=>console.log(JSON.parse(s)$1))"; }

for profile in "${profiles[@]}"; do
  for name in "${!tasks[@]}"; do
    clone="$out/$profile/$name"
    rm -rf "$clone" && git clone -q "$fixture" "$clone" && (cd "$clone" && git remote remove origin) || exit 1
    rd="$(node "$root/src/cli.ts" start --project "$clone" | json .run_dir)"
    node "$root/src/cli.ts" approve-command "$rd" test >/dev/null
    start=$(date +%s)
    ( cd "$clone" && AGENTSHIP_EVAL_TASK="$name" timeout 3600 claude -p "/agentship:dev --no-proposals --profile $profile ${tasks[$name]}" \
        --plugin-dir "$root" --setting-sources project,local --no-session-persistence \
        --permission-mode acceptEdits --allowedTools "${allowed[@]}" \
        --disallowedTools "Bash(git push*)" "Bash(gh *)" "Bash(npx *)" "Bash(git commit*)" \
        --output-format json > "$out/$profile-$name.json" 2> "$out/$profile-$name.err" )
    echo "$profile $name exit=$? seconds=$(( $(date +%s) - start ))" | tee -a "$out/summary.txt"
    for run in "$clone"/.agentship/runs/*/; do [ -f "$run/state.json" ] && node "$root/src/cli.ts" report "$run" >/dev/null; done
  done
done

node "$root/src/cli.ts" compare "$out" | tee "$out/compare.json"
