# Canary progress

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
