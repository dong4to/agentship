import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import packs from '../../config/domain-packs.json' with { type: 'json' };
import { planAgents, type Packs } from '../../src/agents/matcher.ts';
import { discoverAgents, parseFrontmatter } from '../../src/agents/registry.ts';

const pluginRoot = fileURLToPath(new URL('../../', import.meta.url));
const roles = { research: { model: 'opus', effort: 'medium' }, review: { model: 'sonnet', effort: 'high' } };
const tmp = () => mkdtempSync(join(tmpdir(), 'as-agents-'));
const agent = (dir: string, name: string) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.md`), `---\nname: ${name}\ndescription: ${name} agent\nmodel: sonnet\n---\nbody\n`);
};

// A fake user dir with a VoltAgent-like category plugin installed.
function userWithPlugin() {
  const user = tmp();
  const install = join(user, 'plugins', 'cache', 'voltagent', 'voltagent-domains', '1.0.0');
  agent(join(install, 'agents'), 'fintech-engineer');
  agent(join(install, 'agents'), 'payment-integration');
  writeFileSync(join(user, 'plugins', 'installed_plugins.json'), JSON.stringify({
    version: 2,
    plugins: { 'voltagent-domains@voltagent-subagents': [{ scope: 'user', installPath: install, version: '1.0.0' }] },
  }));
  return user;
}

test('frontmatter parsing', () => {
  assert.deepEqual(parseFrontmatter('---\nname: x\ndescription: "a b"\n---\n'), { name: 'x', description: 'a b' });
  assert.deepEqual(parseFrontmatter('no frontmatter'), {});
});

test('discovers project, plugin and AgentShip agents with their invoke names', () => {
  const project = tmp();
  agent(join(project, '.claude', 'agents'), 'ledger-expert');
  const found = discoverAgents({ projectDir: project, userClaudeDir: userWithPlugin(), pluginRoot });
  const by = (n: string) => found.find((a) => a.name === n);
  assert.deepEqual([by('ledger-expert')?.source, by('ledger-expert')?.invoke], ['project', 'ledger-expert']);
  assert.equal(by('fintech-engineer')?.invoke, 'voltagent-domains:fintech-engineer');
  assert.equal(by('planner')?.invoke, 'agentship:planner');
});

test('no specialists installed: domain still gets a generic slot and its checklist', () => {
  const plan = planAgents(['accounting', 'cooking'], [], packs as Packs, roles);
  assert.deepEqual(plan.unknown_domains, ['cooking']);
  assert.deepEqual([plan.phases.research[0].agent, plan.phases.research[0].model], [null, 'opus']);
  assert.match(plan.checklist[0].items.join(), /Double entry/);
});

test('plugin specialists are matched per phase and domain, with the phase model', () => {
  const found = discoverAgents({ projectDir: tmp(), userClaudeDir: userWithPlugin(), pluginRoot });
  const plan = planAgents(['payments', 'accounting'], found, packs as Packs, roles);
  assert.equal(plan.phases.research[0].agent, 'voltagent-domains:payment-integration');
  // accounting falls back to fintech-engineer
  assert.equal(plan.phases.research[1].agent, 'voltagent-domains:fintech-engineer');
  // review: payments takes fintech-engineer; accounting cannot reuse it in the same phase
  assert.equal(plan.phases.review[0].agent, 'voltagent-domains:fintech-engineer');
  assert.notEqual(plan.phases.review[1].agent, 'voltagent-domains:fintech-engineer');
  assert.equal(plan.phases.review[0].model, 'sonnet');
});

test('a project agent wins over a plugin agent; wildcards match', () => {
  const project = tmp();
  agent(join(project, '.claude', 'agents'), 'acme-accounting-reviewer');
  const found = discoverAgents({ projectDir: project, userClaudeDir: userWithPlugin(), pluginRoot });
  const plan = planAgents(['accounting'], found, packs as Packs, roles);
  assert.deepEqual([plan.phases.research[0].agent, plan.phases.research[0].source], ['acme-accounting-reviewer', 'project']);
});

test('specialists per phase are capped', () => {
  const plan = planAgents(['security', 'auth', 'payments'], [], packs as Packs, roles);
  assert.equal(plan.phases.review.length, (packs as Packs).max_specialists_per_phase);
});
