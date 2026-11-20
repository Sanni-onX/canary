# Canary progress

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
