// Agent registry (H2.9): finds the subagents available to Claude Code, without loading or running them.
// Sources, in priority order: the project's .claude/agents, the user's ~/.claude/agents, installed plugins
// (e.g. VoltAgent category plugins), and AgentShip's own agents/.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

export type AgentSource = 'project' | 'user' | 'plugin' | 'agentship';
export const SOURCE_PRIORITY: AgentSource[] = ['project', 'user', 'plugin', 'agentship'];

export interface AgentInfo {
  name: string; // short name from frontmatter (or file name)
  invoke: string; // what to pass as subagent_type: "plugin:name" for plugins, "name" otherwise
  description: string;
  model: string | null;
  source: AgentSource;
  plugin: string | null;
  path: string;
}

export function parseFrontmatter(text: string): Record<string, string> {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const out: Record<string, string> = {};
  if (!m) return out;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (kv) out[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

function mdFiles(dir: string, depth = 2): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory() && depth > 0) out.push(...mdFiles(p, depth - 1));
    else if (st.isFile() && entry.endsWith('.md') && entry.toLowerCase() !== 'readme.md') out.push(p);
  }
  return out;
}

function readAgents(dir: string, source: AgentSource, plugin: string | null): AgentInfo[] {
  return mdFiles(dir).flatMap((path) => {
    let fm: Record<string, string>;
    try {
      fm = parseFrontmatter(readFileSync(path, 'utf8'));
    } catch {
      return [];
    }
    const name = fm.name || basename(path, '.md');
    if (!fm.description) return []; // not an agent definition
    return [{
      name,
      invoke: plugin ? `${plugin}:${name}` : name,
      description: fm.description,
      model: fm.model || null,
      source,
      plugin,
      path,
    }];
  });
}

// installed_plugins.json: { version, plugins: { "<name>@<marketplace>": [{ installPath, ... }] } }
function pluginDirs(userClaudeDir: string): { plugin: string; dir: string }[] {
  try {
    const raw = JSON.parse(readFileSync(join(userClaudeDir, 'plugins', 'installed_plugins.json'), 'utf8'));
    const plugins = raw.plugins ?? raw;
    return Object.entries(plugins).flatMap(([key, entry]) => {
      const installs = (Array.isArray(entry) ? entry : [entry]) as { installPath?: string }[];
      const dir = installs.find((e) => e?.installPath)?.installPath;
      return dir ? [{ plugin: key.split('@')[0], dir }] : [];
    });
  } catch {
    return [];
  }
}

export function discoverAgents(opts: { projectDir: string; userClaudeDir: string; pluginRoot: string }): AgentInfo[] {
  const agents = [
    ...readAgents(join(opts.projectDir, '.claude', 'agents'), 'project', null),
    ...readAgents(join(opts.userClaudeDir, 'agents'), 'user', null),
    ...pluginDirs(opts.userClaudeDir)
      .filter((p) => p.plugin !== 'agentship')
      .flatMap((p) => readAgents(join(p.dir, 'agents'), 'plugin', p.plugin)),
    ...readAgents(join(opts.pluginRoot, 'agents'), 'agentship', 'agentship'),
  ];
  return agents;
}
