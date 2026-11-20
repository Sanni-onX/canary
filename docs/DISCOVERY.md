# Phase 0 discovery

Evidence gathered 20 November 2026. This phase is **in progress**. No contract
has been persistently deployed and no wallet transaction has been broadcast.
No vault or watcher is implemented yet. A minimal Next.js discovery console is
now available; it sends no transactions. New account and mobile-only integration
findings are in `QOREX_INTEGRATION.md` and supersede the earlier pending items
below. Account funding/PQ possession and an existing human hybrid transaction
are now independently verified. Browser PQ signing passed Chromium tests;
actual QoreX mobile execution still needs a secure HTTPS preview.

## Primary sources

| Source | What it establishes |
| --- | --- |
| https://build.qorechain.io/start | Setup, testnet endpoints, submission checklist |
| https://build.qorechain.io/rules | Dates, originality, licensing, registration, team limits |
| https://build.qorechain.io/kits | Published packages and starter templates |
| https://build.qorechain.io/prizes | Post-Quantum dApp requirements |
| https://build.qorechain.io/faq | Audit evidence, precompiles, wallet signatures, verification limits |
| https://docs.qorechain.io/developer-guide/evm-precompiles/ | Exact verifier ABI/address and fail-closed requirement |
| https://docs.qorechain.io/developer-guide/evm-window-reference/ | Scoped window admission, bounds, targets, hybrid authorisation |
| https://docs.qorechain.io/qorex/browser-extension/ | Native signAndBroadcast; EVM provider signing limitation |
| https://github.com/qorechain/qorechain-sdk | SDK and CLI source/provenance |
| https://github.com/qorechain/qorechain-pqc | ML-DSA implementation and shared vectors |
| Installed `node_modules/@qorechain/pqc/src/index.js` | Actual 0.2.3 exports, lengths, signing argument order |

The rules may change. Recheck before submission. The starter's `qor_*`
tokenomics example is not evidence that those RPC methods work on public nodes.

## Assumptions register

| ID | Finding and evidence | Status / remaining work |
| --- | --- | --- |
| A1 | A Solidity `addr.balance` read ran on testnet inside contract-creation `eth_call` and matched `eth_getBalance`. Repeated at block 10,455,926 on the supplied account: 49.865 QOR. Local Foundry fuzz coverage includes arbitrary balances. | Funded-account read-only check passed. Persistent probe deployment pending. ERC-20 fallback not needed so far. |
| A2 | Exact call is `pqcVerify(bytes pubkey, bytes signature, bytes message)` at `0x0000000000000000000000000000000000000a01`. Fresh real signature accepted, altered message rejected; Solidity call returned true. Active list saved in `evidence/discovery.json`. | Passed read-only integration; persistent deployment and signed transaction still pending. No mock used on testnet. |
| A3 | Real chain-level admission gate. Native hybrid-signed window bounds blocks, transactions, QOR value plus maximum fees, and allowed targets. Classical keys alone cannot open it. | Confirmed from reference and starter. Need one opened scoped window and native tx receipt as project evidence. Save signed request scope too. |
| A4 | Published `@qorechain/pqc@0.2.3` uses noble's JS ML-DSA-87. Node known-answer vectors pass at pinned revision `66ff1eb447772f2f8036a0bf5050ae1573baeb85`. Real keygen/sign/verify and altered-message rejection also passed Chromium desktop/mobile-viewport tests. | General browser runtime passed. Actual QoreX mobile device still pending. Used the planned Next.js app for the small browser proof instead of a temporary Vite app; cryptographic scope is unchanged. No hosted signer. |
| A5 | QoreX is EIP-1193 compatible for accounts/network **but its documented EVM interface cannot send transactions**. Native `signAndBroadcast` is supported and keeps the wallet's PQ key in QoreX. | Human selected QoreX mobile only. Native session-key EVM candidate is unverified/disabled; see `QOREX_INTEGRATION.md`. No invented support, second wallet or permissions enabled. |
| A6 | Measured Solidity verifier call including probe ABI/call overhead: **109,162 gas cold**, block 10,455,926; initial warm-address run was 106,662. Block gas limit: 4,294,967,295. | Read-only measurement passed. Governance path and actual tx gas not measured. Do not equate native hybrid verification gas with this precompile. |
| A7 | Testnet REST params and JSON-RPC reads/eth_call succeeded, with 20-second client timeouts. | Basic connectivity passed. Sustained watcher limits, subscriptions, faucet claim and full E2E remain untested. |
| A8 | FAQ explicitly says explorer source verification and Etherscan-compatible API are not available. | Use documented fallback: publish source and exact compiler settings plus real deployment receipt. No claim of verified explorer source. |
| A9 | Both QCAI runs must use the same EVM/Solidity setting. Stage 2 follows triage of every Stage 1 finding. Store dated PDFs under `docs/audit/`, response mapping in `docs/AUDIT.md`, link README and project How it's made. EVM quantum readiness may say Not scored. | Procedure confirmed; actual audits pending contracts. Canonical PDF location follows current FAQ; raw artifacts also go in `audit/`. |
| A10 | A drain followed by a top-up before the registry transaction can hide the loss from a balance-only detector. Every-block polling cannot guarantee inclusion before the top-up. | Residual risk confirmed by reasoning; adversarial sequence tests belong in Phase 1/2. No guarantee of quantum-attack attribution. |

## Fest checklist verified

- Build window: 4 November–2 December 2026. Final deadline 2 December 23:59 UTC;
  internal target 12:00 UTC (13:00 Lagos).
- Post-Quantum dApp: 1–3 members; scoped window, real pqcVerify, two-stage QCAI,
  Foundry or Hardhat tests.
- Submission: public repo, MIT/Apache-2.0, README, up to 3-minute working video,
  actual testnet addresses, credited dependencies/templates, registered members.
- Rules request a featured image, although Start describes a generated default.
  Plan to provide our own 16:9 cover, at least 1200 × 675, under 5 MB.
- The official Q-Day Drill registration closed 17 November and drill ran
  18 November. It is already past. Canary's own simulation remains in scope;
  do not claim participation or eligibility for the official drill award.
- Human confirmed completed registration. The supplied wallet's funding,
  registered/proven key and prior successful hybrid transfer have now been
  independently verified; fest account registration remains human-confirmed.

## Reproduction

```powershell
npm ci
npm run test:discovery
npm run typecheck
node scripts/forge.mjs install foundry-rs/forge-std@v1.9.7 --no-git
node scripts/forge.mjs test -vv
npm run discovery
```

`npm run discovery` is read-only and overwrites the timestamped-current result
file `docs/evidence/discovery.json`. It refuses chains other than 9800; its
endpoints are fixed to public testnet. It creates an ephemeral, unfunded PQ key
in memory, signs only a discovery message and clears its secret buffer in
`finally`. JavaScript memory wiping cannot prove destruction.

The Solidity creation call instantiates the probe only within simulated state.
It is not a deployed contract, a hybrid transaction or submission evidence for
deployment. The original zero-balance target is retained as
`evidence/initial-discovery.json`. The current result uses the funded user account.

## Toolchain and local issues

- Node 22.13.1, npm 11.1.0; TypeScript strict from official starter.
- Official `create-qorechain-dapp@0.14.0` generated Foundry project and a Vite
  reference with `--network testnet --package-manager npm --yes --no-install`.
- Foundry 1.7.1 Windows binary, solc 0.8.28, Paris target, optimizer 200 runs.
- Upstream Forge npm wrapper postinstall uses POSIX assignment and failed on
  Windows. `scripts/forge.mjs` runs the official platform binary directly;
  Unix uses installed Forge. Binary is an optional platform dependency.
- Unprivileged shell npm could not resolve the registry. Approved network
  execution succeeded. No credentials were used.
- Starter modifications: mainnet signing/deployment guards, target-scoped
  windows required except explicitly marked contract-creation sessions, pinned
  forge-std, Paris EVM, and probe deployment target. Original template credited.

## Before closing Phase 0

1. Resolve the QoreX-mobile-only EVM submission path without secret export.
2. Publish a secure preview and test the actual QoreX mobile connection.
3. Retain the passed browser/known-vector and funded-account evidence.
4. Obtain scoped window evidence; existing human hybrid transfer is verified.
5. Simulate, deploy the read-only probe, then record address and receipts.
6. Re-measure actual transaction gas and close the discovery checkpoint.
