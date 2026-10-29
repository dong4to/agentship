import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectGsd } from '../../src/integrations/gsd/detect.ts';

const tmp = () => mkdtempSync(join(tmpdir(), 'agentship-'));
const touch = (path: string, content = '') => {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
};

test('no GSD anywhere: not installed, with an install hint', () => {
  const g = detectGsd(tmp(), tmp());
  assert.deepEqual([g.installed, g.commands, g.found], [false, null, []]);
  assert.match(g.install_hint ?? '', /@opengsd\/gsd-core/);
});

test('npm --local install in the project: /gsd-quick and version', () => {
  const project = tmp();
  touch(join(project, '.claude', 'commands', 'gsd-quick.md'));
  touch(join(project, '.claude', 'gsd-core', 'VERSION'), '1.19.0\n');
  const g = detectGsd(project, tmp());
  assert.deepEqual([g.source, g.version, g.commands?.quick], ['project', '1.19.0', '/gsd-quick']);
});

test('npm --global install as a skill in the user dir', () => {
  const user = tmp();
  touch(join(user, 'skills', 'gsd-quick', 'SKILL.md'));
  assert.equal(detectGsd(tmp(), user).source, 'user');
});

test('plugin install is namespaced /gsd-core:gsd-*', () => {
  const user = tmp();
  touch(
    join(user, 'plugins', 'installed_plugins.json'),
    JSON.stringify({ version: 2, plugins: { 'gsd-core@gsd-core': [{ scope: 'user', version: '1.19.0' }] } }),
  );
  const g = detectGsd(tmp(), user);
  assert.deepEqual([g.source, g.version, g.commands?.quick], ['plugin', '1.19.0', '/gsd-core:gsd-quick']);
});

test('npm install wins over plugin when both exist', () => {
  const project = tmp();
  const user = tmp();
  touch(join(project, '.claude', 'commands', 'gsd-quick.md'));
  touch(join(user, 'skills', 'gsd-core', '.claude-plugin', 'plugin.json'), '{"version":"1.19.0"}');
  const g = detectGsd(project, user);
  assert.deepEqual([g.source, g.found], ['project', ['project', 'plugin']]);
  assert.equal(g.commands?.quick, '/gsd-quick');
});

test('phase loop availability follows .planning/ROADMAP.md', () => {
  const project = tmp();
  assert.equal(detectGsd(project, tmp()).project_initialized, false);
  touch(join(project, '.planning', 'ROADMAP.md'));
  assert.equal(detectGsd(project, tmp()).project_initialized, true);
});
