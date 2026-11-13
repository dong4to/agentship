// Stand-in for the Codex CLI in tests. Behaviour is chosen with FAKE_CODEX_MODE:
//   ok (default) | clean | unauth | old | timeout | crash | bad-output | modify | sandbox-broken
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const mode = process.env.FAKE_CODEX_MODE ?? 'ok';

if (args[0] === '--version') {
  console.log('codex-cli 0.145.0');
  process.exit(0);
}
if (args[0] === 'login' && args[1] === 'status') {
  if (mode === 'unauth') {
    console.error('Not logged in');
    process.exit(1);
  }
  console.log('Logged in using ChatGPT');
  process.exit(0);
}
if (args[0] === 'exec' && args.includes('--help')) {
  const flags = ['--sandbox', '--output-schema', '--output-last-message', '--ephemeral', '--cd'];
  console.log((mode === 'old' ? flags.filter((f) => f !== '--output-schema') : flags).join('\n'));
  process.exit(0);
}
if (args[0] === 'exec') {
  if (!args.includes('read-only')) {
    console.error('expected --sandbox read-only');
    process.exit(3);
  }
  const out = args[args.indexOf('--output-last-message') + 1];
  const cd = args[args.indexOf('--cd') + 1];
  let stdin = '';
  process.stdin.on('data', (c) => (stdin += c));
  process.stdin.on('end', () => {
    if (mode === 'timeout') return setTimeout(() => {}, 60_000);
    if (mode === 'crash') {
      console.error('boom');
      process.exit(2);
    }
    if (mode === 'modify') appendFileSync(join(cd, 'src.js'), '\n// codex was here\n');
    if (mode === 'bad-output') return writeFileSync(out, 'not json at all');
    const findings = mode === 'clean' ? [] : [
      { id: 'F1', severity: 'HIGH', category: 'correctness', file: 'src.js', line: 1, title: 'Off by one', evidence: 'loop ends early', recommendation: 'use <=' },
      { id: 'F2', severity: 'LOW', category: 'tests', file: 'src.js', line: null, title: 'Missing edge test', evidence: 'no test for 0', recommendation: 'add one' },
    ];
    const sawDiff = stdin.includes('BEGIN DIFF') && stdin.includes('module.exports');
    const broken = mode === 'sandbox-broken';
    const coverage = broken ? 'none' : sawDiff ? 'complete' : 'partial';
    writeFileSync(out, JSON.stringify({ summary: 'reviewed', coverage, limitations: broken ? 'Access is denied when starting processes' : '', reviewed_files: sawDiff ? ['src.js'] : [], findings: broken ? [] : findings }));
    console.log('done');
  });
} else {
  console.error(`unexpected args ${args.join(' ')}`);
  process.exit(64);
}
