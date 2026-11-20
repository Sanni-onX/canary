import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// The upstream @foundry-rs/forge 1.7.1 wrapper's postinstall uses POSIX env
// assignment and fails on Windows. Use its official platform binary directly.
const executable = process.platform === 'win32'
  ? fileURLToPath(new URL('../node_modules/@foundry-rs/forge-win32-amd64/bin/forge.exe', import.meta.url))
  : 'forge';
const args = process.argv.slice(2);
if (['test', 'build', 'fmt', 'install', 'script', 'snapshot', 'coverage'].includes(args[0]) && !args.includes('--root')) {
  args.push('--root', fileURLToPath(new URL('../contracts/', import.meta.url)));
}
const result = spawnSync(executable, args, { stdio: 'inherit', shell: false });
if (result.error) { console.error(result.error.message); process.exit(1); }
process.exit(result.status ?? 1);
