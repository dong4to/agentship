import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, roleForAttempt } from '../../src/config/config.ts';

const tmp = () => mkdtempSync(join(tmpdir(), 'as-cfg-'));
const writeUser = (user: string, o: unknown) => {
  mkdirSync(join(user, 'agentship'), { recursive: true });
  writeFileSync(join(user, 'agentship', 'config.json'), JSON.stringify(o));
};
const writeProject = (project: string, o: unknown) => writeFileSync(join(project, 'agentship.config.json'), JSON.stringify(o));

test('defaults: balanced profile, roles resolved to aliases, no errors', () => {
  const c = loadConfig({ projectDir: tmp(), userClaudeDir: tmp() });
  assert.deepEqual(c.errors, []);
  assert.equal(c.profile, 'balanced');
  assert.deepEqual([c.roles.planner.model, c.roles.planner.effort, c.roles.planner.tier], ['opus', 'high', 'deep']);
  assert.equal(c.roles.independent_reviewer.runtime, 'codex');
  assert.equal(c.settings.retries.tests_per_wave, 2);
});

test('profiles switch models by configuration, no model IDs involved', () => {
  const economy = loadConfig({ projectDir: tmp(), userClaudeDir: tmp(), profile: 'economy' });
  assert.equal(economy.roles.planner.model, 'opus');
  assert.equal(economy.roles.planner.effort, 'medium');
  assert.equal(economy.roles.proposer.model, 'sonnet');
  assert.match(loadConfig({ projectDir: tmp(), userClaudeDir: tmp(), profile: 'nope' }).errors.join(), /not a known profile/);
});

test('user config: custom tier and profile, retries, codex', () => {
  const user = tmp();
  writeUser(user, { tiers: { haiku: { runtime: 'claude', model: 'haiku', effort: 'low' } }, profiles: { cheap: { classifier: 'haiku' } }, model_profile: 'cheap', retries: { tests_per_wave: 1 }, codex: { enabled: false } });
  const c = loadConfig({ projectDir: tmp(), userClaudeDir: user });
  assert.deepEqual(c.errors, []);
  assert.equal(c.roles.classifier.model, 'haiku');
  assert.equal(c.roles.planner.model, 'opus'); // inherited from the profile in use
  assert.equal(c.settings.retries.tests_per_wave, 1);
  assert.equal(c.settings.codex.enabled, false);
});

test('invalid values are errors, not silent defaults', () => {
  const user = tmp();
  writeUser(user, { tiers: { x: { runtime: 'gpt', model: 'm', effort: 'low' } }, retries: { tests_per_wave: 99 }, codex: { timeout_seconds: 5 }, bogus: 1 });
  const e = loadConfig({ projectDir: tmp(), userClaudeDir: user }).errors.join('\n');
  assert.match(e, /runtime must be claude\|codex/);
  assert.match(e, /tests_per_wave must be an integer 0-5/);
  assert.match(e, /timeout_seconds must be an integer 30-3600/);
  assert.match(e, /unknown key "bogus"/);
});

test('project config can only make the policy stricter', () => {
  const project = tmp();
  writeProject(project, { policies: { risk_floor: { HIGH: 'SMALL', MEDIUM: 'MEDIUM' }, domain_min_risk: { payments: 'LOW', accounting: 'HIGH' }, independent_review: { required_at_risk: 'MEDIUM' } } });
  const c = loadConfig({ projectDir: project, userClaudeDir: tmp() });
  assert.match(c.errors.join(), /risk_floor.HIGH: a project config can only make the policy stricter/);
  assert.match(c.errors.join(), /domain_min_risk.payments/);
  assert.equal(c.policy.risk_floor.HIGH, 'LARGE');
  assert.equal(c.policy.risk_floor.MEDIUM, 'MEDIUM'); // stricter: applied
  assert.equal(c.policy.domain_min_risk.accounting, 'HIGH');
  assert.equal(c.settings.independent_review.required_at_risk, 'MEDIUM');
  writeProject(project, { policies: { independent_review: { required_at_risk: 'HIGH' } } });
  assert.deepEqual(loadConfig({ projectDir: project, userClaudeDir: tmp() }).errors, []);
});

test('commands only come from the project config', () => {
  const user = tmp();
  writeUser(user, { commands: { test: 'make test' } });
  assert.match(loadConfig({ projectDir: tmp(), userClaudeDir: user }).errors.join(), /commands can only be set in the project config/);
  const project = tmp();
  writeProject(project, { commands: { test: 'make test', deploy: 'x', lint: 'a\nb' } });
  const c = loadConfig({ projectDir: project, userClaudeDir: tmp() });
  assert.equal(c.settings.commands.test, 'make test');
  assert.match(c.errors.join(), /commands.deploy is unknown/);
  assert.match(c.errors.join(), /single-line/);
});

test('project domain packs are added', () => {
  const project = tmp();
  writeProject(project, { domains: { tax: { description: 'tax', agents: { research: ['tax-*'] }, checklist: ['rates are data'] } } });
  assert.ok(loadConfig({ projectDir: project, userClaudeDir: tmp() }).packs.domains.tax);
});

test('broken JSON is reported', () => {
  const project = tmp();
  writeFileSync(join(project, 'agentship.config.json'), '{ nope');
  assert.match(loadConfig({ projectDir: project, userClaudeDir: tmp() }).errors.join(), /agentship.config.json/);
});

test('escalation moves a failing role to a stronger tier', () => {
  const c = loadConfig({ projectDir: tmp(), userClaudeDir: tmp() });
  assert.equal(roleForAttempt(c, 'implementer', 1).model, 'sonnet');
  assert.deepEqual([roleForAttempt(c, 'implementer', 2).model, roleForAttempt(c, 'implementer', 2).tier], ['opus', 'deep']);
  assert.equal(roleForAttempt(c, 'classifier', 9).tier, 'fast');
});
