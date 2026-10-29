#!/usr/bin/env bash
# Builds the AgentShip E2E fixture: sample-project + git + GSD Core (local install) + a minimal .planning seed.
# Usage: tests/e2e/setup-fixture.sh <target-dir> [gsd-version]
# Downloads @opengsd/gsd-core from npm; only run it if you accept that.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
target="${1:?target dir required}"
gsd_version="${2:-1.19.0}"

[ -e "$target" ] && { echo "refusing to overwrite existing $target" >&2; exit 1; }
mkdir -p "$(dirname "$target")"
case "$(cd "$(dirname "$target")" && pwd)/" in
  "$root"/*) echo "target must be outside $root: Claude Code denies writes under a --plugin-dir root" >&2; exit 1 ;;
esac
cp -r "$root/examples/sample-project" "$target"
cd "$target"
git init -q
git -c user.name=agentship-e2e -c user.email=e2e@localhost commit -q --allow-empty -m "init"
git add -A && git -c user.name=agentship-e2e -c user.email=e2e@localhost commit -qm "sample-project baseline"

npx -y "@opengsd/gsd-core@$gsd_version" --claude --local </dev/null
mkdir -p .planning
cp "$here/planning-seed/"*.md .planning/
node .claude/gsd-core/bin/gsd-tools.cjs config-new-project >/dev/null
git add -A && git -c user.name=agentship-e2e -c user.email=e2e@localhost commit -qm "GSD Core $gsd_version (local) + planning seed"
echo "fixture ready: $target"
