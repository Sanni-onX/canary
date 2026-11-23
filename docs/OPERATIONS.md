# Testnet operations

## Automatic alarm

The Railway watcher uses a separate funded testnet account. It has no vault,
policy or governance role. The human explicitly approved uploading only this
bot's generated credential to Railway. Deployer, canary and guardian keys stay
local. The bot's only composed call is checkAndTrip on the configured registry,
submitted as a hybrid native cross-VM call; no EVM window is required for this
top-level owner-signed native route. Fee is capped at 0.1 test QOR per attempt.

Check /status for alarmBot.hasFeeBudget, submissionPending and
lastAlarmTransaction. Keep at least 0.1 test QOR in the bot; 1 QOR is a useful
small test buffer. Funding is separate from registry coverage. A pending intent
is persisted before broadcast. An uncertain outcome suspends duplicate sends:
inspect the native receipt and registry state before reconciling the database.
An observed latched alarm clears the pending marker. Never clear it blindly.

The real hosted-bot test is saved in docs/evidence/automatic-alarm-test.json.
It used controlled hybrid native spends from retained-key drill accounts, not
a classical key compromise. The bot's receipt sender and target were verified.

## Coverage maintenance

The watcher stores maintenance_jobs in SQLite and emits coverage_maintenance
when an epoch enters scheduled, due, overdue or investigate state. The app shows
the same plan under Coverage maintenance deadlines. Preparation becomes due
1,200 blocks before expiry; block heights are authoritative. Unknown RPC state
requires investigation. A lapse is not a drain and does not trigger/reset alarm.

For each due slot, on the local operator machine:

`node scripts/prepare-next-epoch.mjs` prepares an idempotent three-slot public
plan without transactions. For later cycles, pass `--new` after the previous
replacement run completes; this archives the previous public plan before
preparing new accounts. Once the operator is funded, `node
scripts/maintain-epoch.mjs` funds the fresh accounts, exposes them and performs
the local PQ-governed replacements. The current three-slot run completed on
23 November, restoring three covered canaries; all exposure, queue and execute
receipts are retained in docs/evidence/next-epoch.json. It preserves the alarm and
produces an unsigned reset proposal for separate review. It does not destroy keys.

The individual ceremony workflow remains available:

1. Run `node scripts/canary-ceremony.mjs prepare --slot 0` (use the actual slot).
2. Fund the new public address with test QOR, then run `expose <id> --send`.
3. Review the generated unsigned replaceCanary proposal against revision 2.
4. Obtain local PQ guardian quorum, queue, wait for the timelock and execute.
5. Verify the new account, baseline and usable permission window on chain.
6. Only after registration, choose whether to attest local key-file removal.
   Other copies and physical destruction cannot be proven.

Do not upload guardian keys to the watcher or renew canaries whose classical
keys were destroyed. Preparation/deadline monitoring is automated; fresh
funding, governance and destruction remain explicit operator procedures.
Replacing slots never clears an alarm. Reset needs its separate PQ-governed,
cooldown-bound evidence process and invalidates no historical alarm evidence.

## Mobile access

Extension: unlock, tap the version number seven times, choose Diana testnet.
Mobile: Settings → Use testnet, then open Canary in the QoreX dApp Browser.
The page QR is a URL handoff only, not a WalletConnect pairing session.
