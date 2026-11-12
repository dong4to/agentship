#!/usr/bin/env bash
# Builds the AgentShip E2E fixture: sample-project in a fresh git repo. Nothing is downloaded.
# Usage: tests/e2e/setup-fixture.sh <target-dir>
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
target="${1:?target dir required}"

[ -e "$target" ] && { echo "refusing to overwrite existing $target" >&2; exit 1; }
mkdir -p "$(dirname "$target")"
case "$(cd "$(dirname "$target")" && pwd)/" in
  "$root"/*) echo "target must be outside $root: Claude Code denies writes under a --plugin-dir root" >&2; exit 1 ;;
esac
cp -r "$root/examples/sample-project" "$target"
cd "$target"
git init -q
git add -A && git -c user.name=agentship-e2e -c user.email=e2e@localhost commit -qm "sample-project baseline"
echo "fixture ready: $target"
