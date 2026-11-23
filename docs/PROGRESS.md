# Canary progress

## 23 November — release continuation

Update: Stage 2 PDF received and preserved in docs/audit/2026-11-23-stage-2.pdf.
Same Ethereum setting, 72/100 medium, five findings. All five mapped in
docs/AUDIT.md; no executable contract change justified. The new high finding
targets an already-public-view observation function. Four targeted tests passed
again, including full-range arithmetic fuzz comparison. Both QCAI stages are
now evidenced. Earlier pending references below describe the prior checkpoint.

Stage 1 report preserved (72/100, medium, five findings). All findings have
source-based dispositions. Existing executable protections already address
the report; explanatory contract comments and two targeted audit regressions
were added. All 29 core/rotation tests, two coverage tests and two watcher
integration tests passed. Stage 2 packet compiles and is prepared at
`audit/qcai/STAGE2-RESPONSE.md`; no second external report exists yet.

Revision 2 deployed using the previously funded operator. All four executable
runtimes matched compiler artifacts. New demo vault creation, 0.001 test QOR
deposit and real ML-DSA withdrawal succeeded; receipts are in
`deployments/testnet-v2.json`. Its registry has no canaries yet, so the hosted
app/watcher deliberately continue monitoring revision 1. User QoreX permissions
were not modified. Session testing remains deferred by the user's prior choice.

Railway web and watcher are running; live API returned HTTP 200 on this date.
Watcher volume is attached. Stage 2 external access, finite-epoch activation,
wallet-backed migration, public repository and video remain release gates.
The older entries below are historical checkpoints, not current completion status.

## Continued 21 November — revision-2 epoch rotation (current)

Client/coverage checkpoint saved as bdc821c. The build and 18 browser checks
passed before this continuation; the local preview has been restored.

Revision-2 source adds governance-only replacement of active or retired slots,
bounded current capacity of 16, historical address-use rejection, and a distinct
replacement event. Retirement/replacement first latch any old-epoch threshold
breach so maintenance cannot erase evidence before a watcher check. Neither
operation clears an alarm or revives old withdrawals. Five new regressions
passed. Stateful tests now also exercise epoch rotation and registry readiness.

The active deployed revision remains **1**, pinned to source commit 287b799 in
its manifest. There is no upgrade path. Revision-2 deployment requires a new
manifest and explicit CLI flag; no deployment was performed. The updated seven
invariants passed 256 campaigns × 500 calls each, including random rotation.
All current contract checks comprise 39 tests: 22 core, five rotation, five
probes, seven invariants. Slither regenerated with 37 reviewed findings; solhint
has zero errors/eight reviewed warnings. The new flattened QCAI bundle compiles.
The old revision-1 reports remain archived separately. Watcher regressions pass.
QoreX session testing remains deferred. The human approved code-only external
QCAI sharing. The complete revision-2 bundle was entered in the official auditor
under Ethereum (EVM/Solidity). The human asked which wallet pays and reported a
recovery-phrase address mismatch. Public dashboard state was checked, with no
secret revealed. Official docs explain the dashboard coin-60 account versus
QoreX's default coin-118 account. Instructions were provided to select the
Ethereum account from the already imported phrase. The 150-QOR payment dialog
was cancelled and code preserved while the wallet selection is resolved.
No audit result or payment is claimed; the source form remains available.

The CLI ceremony fallback now prepares isolated, unfunded local test accounts,
checks public status, gates exposure behind --send, saves pending transaction
hashes for reconciliation, and gates local file removal behind explicit consent,
matching on-chain registration/exposure and at least 600 live blocks. Only
unfunded preparation/status and three refusal guards have been exercised. No
new funding, exposure, governance action or key destruction was performed.
See `docs/CEREMONY.md`; it is not a completed burned-key demonstration.

## Earlier 21 November — live recovery and finite coverage epochs

Human requested finishing the product, deferred the proposed session-key chain
test, and proposed renewable PQ canary leases with a finite-epoch fallback if
renewal requires the classical key. Verified that ordinary windows need both
keys, cannot use authz, replace rather than overlap, and last at most 17,280
blocks. Implemented that stated fallback; no renewal API or scheduler invented.

### Added

- Live owner-vault discovery, native/fUSD/custom-token balances, bounded approval
  review and selected revocation plans. A real public portfolio read found the
  deployed demo vault and fUSD without substituting sample values.
- Decoded actual vault activity with explicit block-window/result caps and
  incomplete-query handling.
- Backup file/IndexedDB restoration, strict JSON validation, public/private key
  consistency self-tests, vault-key binding, five-minute in-memory unlock and
  cleanup. No plaintext key or password is persisted or posted.
- Real local PQ rescue signing, local verification, same-origin preflight and
  public authorization export. New relay CLI validates only public signed
  payloads; its submit path is not claimed as live-tested.
- Public-only resumable migration reports, policy snapshots and strict import
  binding. Imported receipt references do not mark migration complete.
- Shared epoch coverage model checks deadline, transaction/value/balance
  capacity, permitted EOA recipient and conservative native transfer fee budget.
  Overview/Canary Lab show Covered/Expiring/Lapsed/Unknown, exact expiry blocks,
  estimated countdowns, stale-data handling and k+1 margin warnings.
- Watcher persists epoch observations, emits coverage transition warnings and
  exposes coverage/expiry/heartbeat status. Expiry alone never submits an alarm.
- Slither 0.11.5: 38 findings individually triaged with IDs and regression links.
  Solhint 6.2.5: zero errors/eight reviewed warnings. Raw reports/source hashes
  retained; repeatable scripts and CI checks added. These are not QCAI audits.
- Compiling flattened QCAI input, hosting Dockerfiles/Compose and secret-safe
  build context. Docker engine unavailable, so container execution is untested.

### Evidence and checks

New core regressions passed: 22 unit/fuzz tests, including unauthorized release
and full-precision drain threshold. Six previously passed stateful invariants
and five probe tests are unchanged. Three PQ tests and two coverage tests pass.
Two watcher integration tests pass, including expired-window/no-false-alarm.
All **18 desktop/mobile product checks passed** against the production preview.
The per-vault resume isolation regression also passed on desktop/mobile after
the final namespace change. Production build and strict typecheck pass. Live
watcher once-mode independently recorded the real expired windows and degraded
coverage without submitting a transaction. Compose configuration validates;
container runtime remains untested. Final screenshots are in `docs/images/`.

`docs/evidence/protocol-coverage.json` records **zero currently covered intact
canaries** and degraded coverage. The original three windows expired; two bait
accounts were already drained. Historical drill receipts remain valid.

### Blocked / not complete

- QoreX wallet-backed sends: human explicitly deferred session testing. No
  authenticator, rule, key permission or chain transaction was changed here.
- External QCAI: automatic approval review blocked source entry pending explicit
  sharing approval. Human asked why; the requirement was explained. Approval is
  unresolved; no source or payment was submitted. Site displayed 150 test QOR.
- Registry epoch rotation is still limited to 16 lifetime slots. No burned-key
  demonstration, indefinite coverage, production-ready custody, public hosting,
  public GitHub publication or completed submission is claimed.
- Full ceremony, actual wallet deposits/revocations, production-bound deployment,
  required QCAI stages and final video remain open.

This is a client/security checkpoint, not the completed product.

## Earlier 21 November 2026 — working deployed prototype

Human steering: stop building a wallet diagnostic page and build the product.
QoreX extension is now available as well as mobile. Human funded a fresh local
testnet deployer with 5 test QOR, so no personal wallet keys were requested or
provided. Confirmed from the current official FAQ that additional listed project
addresses may deploy; deployer must be added to the project form (not confirmed).

### Implemented and verified

- CanaryRegistry, PQVault, immutable-clone VaultFactory, 2-of-3 PQGovernance.
- Exact bounded rolling-24h spend, delayed large withdrawals, tighten-only
  classical policies, lockdown, fail-closed registry handling, pre-alarm request
  invalidation, nonce/domain-bound PQ rescue, delayed PQ policy/key changes.
- New-key proof of possession and guard-set queue/timelock execution.
- Native and standard ERC-20 custody; fee-on-transfer delta rejection;
  reentrancy defense and bad/expired/replayed authorization rejection.
- Product overview, vault controls, nine-step simulated Lifeboat, ceremony
  draft, interactive drill, activity, threat model, responsive/light/dark UI.
- Real browser ML-DSA-87 and encrypted backup (AES-GCM, PBKDF2-SHA256,
  310,000 iterations) with encrypted-only IndexedDB persistence.
- Watcher block subscription plus HTTP fallback/backoff, SQLite snapshots,
  alarm/balance/retirement logs, health/status, Dockerfile and once mode.
- Separate live dashboard reads actual deployed state and displays real receipts;
  no simulation fallback is used on RPC failure.

### Real testnet outcome

`deployments/testnet.json` contains actual addresses/receipts. Registry, governance,
factory and a clone are deployed. Three retained-key drill accounts were funded,
PQ-registered, window-scoped and added through real two-guardian PQ signatures
and the 60-second timelock.

The actual drill passed: normal classical release; two classical-key canary
drains; watcher-submitted alarm at block **10,475,594**; decoded `ClassicalFrozen`
preflight rejection with unchanged vault balance; real PQ rescue of the remaining
**0.0029 test QOR**. Final vault balance zero; PQ nonce 2. A separate initial
0.001-QOR deposit/PQ-rescue test also passed. No mock verifier was deployed.

Evidence: `docs/evidence/live-drill.json`, `product-smoke.json`, deployment manifest.
The large atomic creation-query gas failure is documented in
`audit/rpc-simulation.md`; the replacement smoke checker validates actual code,
receipts and final state rather than labeling that failed query a pass.

### Validation

- 20 core Foundry unit/fuzz tests + 5 probe tests passed.
- All **6 required invariants passed**, each with 256 campaigns × 500 actions:
  no classical alarm leak; tighten-only classical policy; native conservation;
  alarm latch except governance reset; PQ nonce/replay; old request invalidation.
- 8 upstream/discovery Node tests passed at the prior checkpoint (backend unchanged).
- 3 PQ client tests passed: real backup restoration/signing, bad password and
  tamper rejection, domain/nonce/chain/recipient separation.
- Watcher integration test passed; actual watcher also submitted the live alarm.
- 10 desktop/mobile browser tests passed. TypeScript strict check passed.
- Final production build and strict TypeScript check passed after live-state
  additions. Public evidence uses fixed imports so the server bundle does not
  trace the workspace. Browser screenshots/cover are in `docs/images/`.

### Limits / remaining phases

This is a **short-bound, single-operator testnet demonstration**, not an audited
production deployment. Real external wallet-backed user migration/transactions,
live token/approval scanning and selected revocation, full ceremony,
resumable migration recovery, production-bounds deployment, Slither/solhint,
both QCAI stages, public hosting/repository and final video remain incomplete.
Registry lifetime capacity (16 entries including retired slots) needs a production
rotation design before final deployment. Backend relay/capability integration
must not request personal keys or invent QoreX EVM/QR support.

Phase 1 core is implemented/deployed as a prototype. Phase 2 has governance and
all six invariants, with audits/hardening open. Phase 3 has the client/watcher/UI
foundation. Phase 4 has local product flows and a real CLI-driven testnet drill;
general-user live flows remain open. No definition-of-done claim is made.

The November 20 entries below are historical and superseded by this checkpoint.

## 20 November 2026 — QoreX mobile-only checkpoint (current)

Human decision: QoreX mobile only. No second wallet or linked-key permissions
approved. The native session-key EVM route is a candidate, not a working feature.

Completed since the first checkpoint:

- Verified supplied account's **49.865 test QOR**, registered ML-DSA-87 key and
  proof of possession. Its EVM window is closed. Testnet abstract-account module
  is enabled; no abstract-account record found for this account.
- Verified an existing human native transfer has code 0 and the chain event
  `pqc_hybrid_verify: status=verified`. No repeat transfer needed for basic
  account hybrid evidence. This was not initiated by Canary.
- Repeated Solidity balance/PQ simulation against the funded user address:
  49.865 QOR matched RPC; valid signature accepted, altered message rejected.
- Recorded **109,162 gas cold** and retained the original 106,662 warm-address
  measurement, with the access-cost difference explained.
- Built Next.js discovery console: live public account checks, QoreX connection
  inspection, real ephemeral browser PQ check, responsive light/dark layout.
  No funds move, permissions change or signing requests leave the page.
- Confirmed real browser ML-DSA-87 generation/sign/verify and rejection of an
  altered message under Chromium desktop and mobile viewport. No key POST or
  localStorage persistence in these tests.
- **10/10 browser checks passed**, strict typecheck passed and production build
  passed. Earlier 8 Node/8 Foundry tests are unchanged. CI now includes web build
  and browser checks as well as contract checks; hosted CI has not been run yet.
- Production preview started at `http://127.0.0.1:3000`; live API check returned
  49.865 QOR, proven PQ key and closed window. It is local to this computer.

Still blocked/pending:

- A verified **QoreX-only EVM submission route**. Session-key registration,
  decoded wallet message support and relay topology need proof before enabling.
- Actual QoreX mobile test requires a secure HTTPS preview. Local desktop and
  mobile-viewport tests do not substitute for the installed wallet.
- Scoped EVM-window evidence, persistent probe deployment and real contract tx
  gas remain pending. No vault contracts/deployment or external audit yet.
- SDK/CosmJS direct import failed on Node 22.13.1; read-only account utilities
  use documented REST endpoints. Original CLI helper remains typechecked only.

See `QOREX_INTEGRATION.md` for source evidence and conditions for any permission
change. The earlier checkpoint below is historical; current findings supersede
its pending public-address, browser-runtime and wallet-choice entries.

## 20 November 2026 — Phase 0 checkpoint (incomplete)

Completed:

- Read the full prompt and verified current official start/rules/kits/FAQ/prizes.
- Generated Foundry and web reference with official starter 0.14.0.
- Verified real testnet PQ signature acceptance/rejection and a Solidity native
  balance/verifier read through contract-creation simulation.
- Added Solidity negative/fuzz checks, strict TypeScript check and Node tests.
- Added testnet-only deployment/signing guards, scoped-window validation,
  pinned compiler/tool/library settings and MIT license with upstream credits.
- Saved discovery, gas, architecture, threat-model and audit requirements.
- Initialized local Git; this checkpoint is the first local commit.

Validation:

- `npm run test:discovery`: **8/8 passed**, including all five upstream ML-DSA-87
  known-answer cases pinned to an exact source revision.
- `npm run typecheck`: **passed**.
- Foundry: **8/8 passed**, including 3 original Counter tests; two fuzz tests
  each ran 256 cases. No vault invariants exist yet.
- `forge fmt --check`: **passed**. Git whitespace check passed.
- Real testnet evidence: block 10,455,150; valid signature true, altered message
  false; Solidity probe verifier call **106,662 gas**. No broadcast.

Dependencies on the human / unresolved checks:

- Public funded wallet address requested; registration/funding confirmed by
  human only. Never request or accept secrets in chat.
- QoreX's documented EVM provider cannot send EVM transactions. Decision pending
  on QoreX native plus a separate EVM wallet for the same testnet account.
- First hybrid-signed transaction, scoped window evidence, persistent probe
  deployment, browser runtime and actual tx gas remain pending. Known vectors
  pass in Node; browser execution remains separate evidence.

Assumptions/deviations:

- A1/A2 passed read-only checks; neither is marked fully deployed/complete.
- A3 confirmed as a real chain admission feature.
- A8 uses the prompt's fallback: published source/settings; explorer cannot verify.
- Current FAQ requires PDFs under `docs/audit/` in addition to raw `audit/` files.
- Official fullstack starter is Vite. Keep a reference and retain the proposed
  Next.js app rather than claiming the starter is Next.js.
- Official Q-Day Drill is past; do not imply participation.
- No core implementation started while the wallet integration decision is pending.

## Remaining phases

| Phase | Scope | Status |
| --- | --- | --- |
| 0 | Discovery + funded hybrid tx + probes + browser proof | In progress |
| 1 | Registry, vault, factory; unit/fuzz | Not started |
| 2 | PQ governance, timelocks, invariants, Slither, QCAI stage 1 | Not started |
| 3 | PQ package, SQLite watcher, Next.js dashboard/vaults | Not started |
| 4 | Lifeboat, ceremony, labeled drill, Playwright | Not started |
| 5 | QCAI stage 2, deployment, docs, video | Not started |
| Submit | Public repository, cover/video/addresses, project form | Not started |

Internal submission target: 2 December 2026, 12:00 UTC / 13:00 Lagos.
The root build prompt is the detailed source of scope for every remaining phase.
