import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
const id = '11111111-1111-4111-8111-111111111111';
for (const [args, expected] of [
  [['status', '../../personal-wallet'], /Usage:/],
  [['expose', id], /No transaction sent/],
  [['attest-destruction', id], /No file removed/],
]) test(`ceremony refuses ${args[0]} without a valid explicit action before account access`, () => {
  const result = spawnSync(process.execPath, ['scripts/canary-ceremony.mjs', ...args], { encoding: 'utf8', timeout: 30000,
    env: { ...process.env, HTTP_PROXY: 'http://127.0.0.1:1', HTTPS_PROXY: 'http://127.0.0.1:1' } });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, expected);
  assert.doesNotMatch(result.stderr, /ENOENT|fetch failed/);
});
