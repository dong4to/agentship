#!/usr/bin/env bash
# Installs AgentShip from this checkout as a marketplace into a throwaway Claude config dir, checks it loads,
# updates and uninstalls it. Never touches the developer's real ~/.claude (CLAUDE_CONFIG_DIR is a temp dir).
# Usage: tests/e2e/install-test.sh
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
cfg="$(mktemp -d)"
trap 'rm -rf "$cfg"' EXIT
export CLAUDE_CONFIG_DIR="$cfg"
step() { printf '\n== %s\n' "$*"; }

step "marketplace add (local checkout)"
claude plugin marketplace add "$root"
step "install"
claude plugin install agentship@agentship
step "list"
claude plugin list | tee "$cfg/list.txt"
grep -q "agentship" "$cfg/list.txt"
step "doctor through the installed copy"
installed="$(node -e "const j=require(process.argv[1]);const e=Object.entries(j.plugins).find(([k])=>k.startsWith('agentship@'));console.log(e[1][0].installPath)" "$cfg/plugins/installed_plugins.json")"
node "$installed/src/cli.ts" doctor --project "$root" > "$cfg/doctor.json"
node -e "const d=require(process.argv[1]);if(!d.agentship)process.exit(1);console.log('agentship',d.agentship,'checks:',d.checks.map(c=>c.check+'='+c.ok).join(' '))" "$cfg/doctor.json"
step "update"
claude plugin marketplace update agentship
claude plugin update agentship@agentship || true
step "uninstall"
claude plugin uninstall agentship@agentship
claude plugin list | tee "$cfg/list2.txt"
if grep -q "agentship@agentship" "$cfg/list2.txt"; then echo "still installed" >&2; exit 1; fi
echo; echo "install test passed"
