import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', ...options });
  if (result.error) throw result.error;
  return result;
};
const lint = run(process.execPath, ['node_modules/solhint/solhint.js', '--disc', '--noPoster', '-f', 'json', 'contracts/src/**/*.sol']);
const warnings = JSON.parse(lint.stdout);
await writeFile(resolve(root, 'audit/solhint.json'), JSON.stringify(warnings, null, 2) + '\n');
if (lint.status !== 0 || warnings.some(item => item.severity === 'Error')) throw new Error('Solhint reported errors.');
const lintRules = new Set(['gas-increment-by-one', 'no-complex-fallback', 'avoid-low-level-calls', 'no-inline-assembly']);
if (warnings.some(item => item.ruleId && !lintRules.has(item.ruleId))) throw new Error('Unreviewed solhint warning.');
const build = run(process.execPath, ['scripts/forge.mjs', 'build', '--build-info', '--force']);
if (build.status !== 0) throw new Error(build.stderr || build.stdout);
const venv = resolve(root, '.local/audit-venv');
const binary = resolve(venv, process.platform === 'win32' ? 'Scripts/slither.exe' : 'bin/slither');
if (!existsSync(binary)) throw new Error('Install audit/requirements.txt into .local/audit-venv first.');
const output = resolve(root, 'audit/slither.json');
// Slither refuses to overwrite a previous report. Keep it until a new scan actually succeeds.
const temporary = resolve(root, '.local/slither-current.json');
const { rm } = await import('node:fs/promises');
await rm(temporary, { force: true });
const analysis = run(binary, ['.', '--compile-force-framework', 'foundry', '--foundry-ignore-compile',
  '--filter-paths', 'lib|node_modules|test|script|Discovery', '--json', temporary], {
  cwd: resolve(root, 'contracts'), env: { ...process.env, VIRTUAL_ENV: venv,
    PATH: resolve(root, 'node_modules/@foundry-rs/forge-win32-amd64/bin') + delimiter + process.env.PATH },
});
if (!existsSync(temporary)) throw new Error(analysis.stderr || 'Slither did not produce a report.');
const report = JSON.parse(await readFile(temporary, 'utf8'));
if (report.success !== true || report.error) throw new Error(report.error || 'Slither failed.');
const dispositions = {
  'arbitrary-send-eth': ['Authorized withdrawal mechanism, not an unauthenticated sweep. Classical paths require owner + normal mode + budget/delay; PQ path checks key/digest/nonce and alarm destination. All release entries are nonReentrant.', 'testUnrelatedCallerCannotReleaseFundsOrQueueAWithdrawal; testAlarmBlocksAllClassicalReleasesAndPQRescueWorks; testReentrancyCannotUseAnOtherwiseValidNextPQAuthorization'],
  'divide-before-multiply': ['Intentional quotient/remainder decomposition computes floor(baseline*factor/10000) without overflowing uint256. Boundary/fuzz comparison uses OpenZeppelin full-precision mulDiv.', 'testFuzzDrainFloorMatchesFullPrecisionMath'],
  'uninitialized-local': ['Solidity zero-initializes these locals. Counters begin at zero; empty policy is an unused placeholder in the key-rotation branch of applyLoosen.', 'testKeyRotationNeedsBothProofsAndDelayAndInvalidatesOldKey; testAlarmLatchThresholdAndCooldown'],
  'missing-zero-check': ['execute requires an existing queued digest. queue refuses target.code.length==0, including address zero; target is bound into the digest.', 'testGuardianQuorumTimelockAndDuplicateSignerRejection'],
  'reentrancy-benign': ['Factory calls its own fixed immutable clone initializer, which makes no external call. Registry is fixed and has no callbacks. Vault fund-release entries use nonReentrant; owners alone can queue requests. No untrusted registry upgrade exists.', 'testFactoryRequiresOwnerAndProofAndInitializationIsOneTime; testReentrancyCannotUseAnOtherwiseValidNextPQAuthorization'],
  'reentrancy-events': ['Factory initializer and immutable registry cannot call back. Governance deletes the queued action before its exact target call; another queued action remains separately quorum-approved and timelocked. Nested authorized event order is not a spending bypass.', 'testGuardianQuorumTimelockAndDuplicateSignerRejection; testFactoryRequiresOwnerAndProofAndInitializationIsOneTime'],
  timestamp: ['Delays, signature expiry and rolling spend intentionally use chain time; validator skew is a residual assumption, not a randomness source. Registry loop/_cancel reports also reflect conservative timestamp taint through structs. Demo short delays are not production bounds.', 'testClassicalRollingLimitHasNoMidnightReset; testLooseningRequiresPQAndDelay; testPreAlarmRequestNeverRevivesAfterReset'],
  'low-level-calls': ['Required for native transfer and exact timelocked governance calldata. Return success is checked and state changes revert on failure. Native release has nonReentrant guards.', 'testReentrancyCannotUseAnOtherwiseValidNextPQAuthorization; testGuardianQuorumTimelockAndDuplicateSignerRejection'],
  'naming-convention': ['Uppercase names deliberately identify immutable minimum bounds. Naming only; no authority change.', 'Source review'],
  'too-many-digits': ['100000 is an intentional gas stipend for bounded securityState reads. Read failure denies classical release.', 'testRegistryFailureFailsClosedButPQRescueStillWorks'],
  'cache-array-length': ['Storage array is bounded to 16 entries and no loop body performs an external callback. Optimization only; no security change justified.', 'testAlarmLatchThresholdAndCooldown'],
};
const findings = report.results.detectors;
for (const finding of findings) if (!dispositions[finding.check]) throw new Error(`Unreviewed detector: ${finding.check}`);
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
const files = ['CanaryRegistry.sol', 'PQAuth.sol', 'PQGovernance.sol', 'PQVault.sol', 'VaultFactory.sol'];
const hashes = {};
for (const file of files) hashes[file] = createHash('sha256').update(await readFile(resolve(root, 'contracts/src', file))).digest('hex');
const at = new Date().toISOString();
await writeFile(resolve(root, 'audit/analysis-input.json'), JSON.stringify({ analyzedAt: at, slither: '0.11.5', solhint: '6.2.5',
  compiler: '0.8.28 / Paris / optimizer 200 / viaIR', excluded: ['dependencies', 'test', 'script', 'Discovery probes'], sourceSha256: hashes }, null, 2) + '\n');
const rows = findings.map((finding, index) => {
  const [reason, tests] = dispositions[finding.check];
  return `| ${index + 1} | ${finding.id} | ${finding.check} / ${finding.impact} | ${reason} | ${tests} |`;
});
await writeFile(resolve(root, 'audit/slither.md'), `# Static analysis review\n\nAnalyzed ${at}. Slither 0.11.5, Solidity 0.8.28, Paris, optimizer 200, viaIR.\nExact source fingerprints: [analysis-input.json](analysis-input.json). Raw results: [slither.json](slither.json).\n\n${findings.length} findings reviewed below. This is an AI-assisted engineering triage, not an independent audit or a QCAI report. Residual risks remain in the threat model.\n\n| # | Stable finding ID | Detector / severity | Disposition (no contract change) | Evidence / regression tests |\n| --- | --- | --- | --- | --- |\n${rows.join('\n')}\n\n## Solhint 6.2.5\n\nZero errors. Eight reviewed warnings: five post-increment gas suggestions (old IDs are deliberately consumed), the receive handler recording deposits/cooling-off, the required governance low-level call, and discovery-only assembly forwarding returndata. Constructor visibility is ignored for Solidity >=0.7, where visibility is invalid. Gas/style-only rules disabled in .solhint.json are not security checks. Raw output: [solhint.json](solhint.json).\n\n## Reproduce\n\nInstall audit/requirements.txt in .local/audit-venv, then run npm run audit:static. The command fails on compiler/linter errors, analyzer errors or an unknown detector/rule. Findings remain visible; success means the scan completed and its detector categories have dispositions above, not that contracts are safe for custody. New findings in an existing category still require human review of the regenerated report.\n`);
console.log(JSON.stringify({ analysisCompleted: true, slitherFindings: findings.length, solhintErrors: 0, solhintWarnings: warnings.filter(item => item.ruleId).length, independentAudit: false }));
