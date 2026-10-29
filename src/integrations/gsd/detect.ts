// Detects GSD Core the way it is actually installed (verified against v1.19.0):
// - npm installer, --local:  <project>/.claude/commands/gsd-quick.md + .claude/gsd-core/VERSION  -> /gsd-quick
// - npm installer, --global: ~/.claude/commands/gsd-quick.md (or skills/gsd-quick/) + ~/.claude/gsd-core/VERSION
// - Claude Code plugin:      installed_plugins.json "gsd-core@..." or ~/.claude/skills/gsd-core/ -> /gsd-core:gsd-quick
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export type GsdSource = 'project' | 'user' | 'plugin';

export interface GsdInfo {
  installed: boolean;
  source: GsdSource | null;
  version: string | null;
  commands: { quick: string; fast: string; discuss: string; plan: string; execute: string; verify: string } | null;
  project_initialized: boolean; // .planning/ROADMAP.md exists: the phase loop is usable
  planning_config: boolean; // .planning/config.json exists
  found: GsdSource[];
  install_hint: string | null;
}

const NPM_INSTALL = 'npx @opengsd/gsd-core@latest --claude --local   (or --global)';

function readVersion(dir: string): string | null {
  try {
    return readFileSync(join(dir, 'gsd-core', 'VERSION'), 'utf8').trim() || null;
  } catch {
    return null;
  }
}

const hasNpmInstall = (claudeDir: string) =>
  existsSync(join(claudeDir, 'commands', 'gsd-quick.md')) || existsSync(join(claudeDir, 'skills', 'gsd-quick', 'SKILL.md'));

function pluginVersion(claudeDir: string): string | null | undefined {
  try {
    const installed = JSON.parse(readFileSync(join(claudeDir, 'plugins', 'installed_plugins.json'), 'utf8'));
    const plugins = installed.plugins ?? installed;
    const key = Object.keys(plugins).find((k) => k.startsWith('gsd-core@'));
    if (key) {
      const entry = plugins[key];
      return (Array.isArray(entry) ? entry[0]?.version : entry?.version) ?? null;
    }
  } catch {
    // no plugin registry: fall through to the skills-dir check
  }
  const manifest = join(claudeDir, 'skills', 'gsd-core', '.claude-plugin', 'plugin.json');
  if (!existsSync(manifest)) return undefined;
  try {
    return JSON.parse(readFileSync(manifest, 'utf8')).version ?? null;
  } catch {
    return null;
  }
}

export function detectGsd(projectDir: string, userClaudeDir: string): GsdInfo {
  const projectClaude = join(projectDir, '.claude');
  const found: GsdSource[] = [];
  let version: string | null = null;

  if (hasNpmInstall(projectClaude)) {
    found.push('project');
    version ??= readVersion(projectClaude);
  }
  if (hasNpmInstall(userClaudeDir)) {
    found.push('user');
    version ??= readVersion(userClaudeDir);
  }
  const pv = pluginVersion(userClaudeDir);
  if (pv !== undefined) {
    found.push('plugin');
    version ??= pv;
  }

  // npm installs expose /gsd-<cmd>; the plugin namespaces them as /gsd-core:gsd-<cmd>.
  const source = found[0] ?? null;
  const p = source === 'plugin' ? '/gsd-core:gsd-' : '/gsd-';
  return {
    installed: source !== null,
    source,
    version,
    commands: source
      ? { quick: `${p}quick`, fast: `${p}fast`, discuss: `${p}discuss-phase`, plan: `${p}plan-phase`, execute: `${p}execute-phase`, verify: `${p}verify-work` }
      : null,
    project_initialized: existsSync(join(projectDir, '.planning', 'ROADMAP.md')),
    planning_config: existsSync(join(projectDir, '.planning', 'config.json')),
    found,
    install_hint: source ? null : NPM_INSTALL,
  };
}
