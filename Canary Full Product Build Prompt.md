
---

## 1. Role and operating rules

You are the lead engineer building **Canary**, a production-grade post-quantum safety layer for QoreChain, from an empty repo to a deployed, tested, documented product. You write Solidity, TypeScript and React to a professional standard.

Rules you never break:

1. **Never invent QoreChain APIs, precompile addresses, contract addresses, package names or CLI flags.** Read the real docs and source first (docs.qorechain.io, github.com/qorechain, build.qorechain.io pages: start, kits, rules, faq, prizes, and the `create-qorechain-dapp` starter). If something cannot be confirmed, record it in `docs/DISCOVERY.md`, pick the fallback from section 10, and flag it to me.
2. **No fake post-quantum.** The deployed contracts must use the chain's real post-quantum verification (`pqcVerify` or whatever it is actually called). A mock verifier may exist only under `contracts/test/mocks/` with `Mock` in its name and must never be deployed.
3. **Testnet only. No real funds.** Never commit secrets. Provide `.env.example`. Never send a PQ private key to any server.
4. **Checkpoint, don't barrel through.** At the end of each phase, commit, update `docs/PROGRESS.md`, and summarize what is done, what is blocked and what you assumed. Stop and ask me if a blocking assumption fails.
5. **Keep `AI_USAGE.md` current** every session: date, task, what the AI generated, what the human decided or corrected. Be honest about the human contribution. This feeds the Best AI-Native Build award.
6. **Credit every library, kit and template** in the README. The project is built during the event (Nov 4 to Dec 2, 2026). Copied projects are disqualified.
7. Prefer small, reviewed, tested increments. No dead code, no TODO left in shipped paths.

## 2. Mission and context

Classical wallet keys (ECDSA on secp256k1) can be broken by a large fault-tolerant quantum computer running Shor's algorithm, which recovers a private key from an exposed public key. Nobody knows when, and there will be no announcement. QoreChain offers post-quantum ML-DSA-87 signatures and hybrid signing.

**Canary** gives users and apps automatic, on-chain protection that activates when keys start to fall:

- **Quantum Canary (the alarm):** bait wallets whose private keys were destroyed after their public keys were exposed. If enough of them are drained, the only plausible explanation is key derivation, so an on-chain alarm trips.
- **PQ-Wrap (the lockdown):** vault contracts with two modes. Normal mode allows limited, low-friction classical use. Alarm mode rejects every classical-authorized action and accepts only post-quantum signatures.
- **Lifeboat (the escape route):** a guided, safe migration of a user's classical wallet into a PQ-protected vault, done before any alarm.

When the alarm trips, funds do not move. They stay in the vault, classical authority is frozen, and the owner can always exit with a PQ signature to a pre-registered rescue address.

## 3. Hackathon constraints (verify every item on the rules page; the organizers say rules may still change)

- Deadline: **Dec 2, 2026, 23:59 UTC**. Internal target: submit by Dec 2, 12:00 UTC.
- Track: **Post-Quantum dApp** (EVM dApp whose sensitive actions get PQ protection). Stated requirements: scoped EVM window, `pqcVerify`, two-stage QCAI audit, Foundry or Hardhat tests. Teams of 1 to 3.
- Submission checks: public GitHub repo under MIT or Apache-2.0, README, video of at most 3 minutes, and the testnet addresses used.
- Registration needs GitHub, X and a QoreX testnet address. Special awards to target: Best AI-Native Build (`AI_USAGE.md`), People's Choice.
- Confirm in Phase 0 exactly what "scoped EVM window" and "two-stage QCAI audit" mean and how they are evidenced. Design around them rather than bolting them on later.

## 4. Threat model and design principles

**Attacker:** can derive a classical private key from any exposed public key, quickly, once Q-Day arrives. Cannot forge ML-DSA-87 signatures. Can front-run, race and submit transactions like anyone else.

**Assets:** funds in PQ-Wrap vaults; integrity of the alarm; availability of the PQ exit.

**Principles:**

- **P1. Classical authority is tighten-only.** A classical key may lower limits, raise delays, lock the vault and cancel pending actions. Loosening anything requires a PQ signature plus a timelock.
- **P2. The PQ exit always works.** In any mode the owner can withdraw with a valid PQ signature. Therefore the vault can fail closed on classical paths without risking trapped funds.
- **P3. Fail closed.** If reading the registry reverts, classical withdrawals are treated as alarm mode.
- **P4. Immutable and backdoor-free.** No proxy admin, no upgrade keys, no owner that can move user funds. Per-user vaults are minimal-proxy clones of an immutable implementation.
- **P5. PQ key bound before the attack.** Registration of a vault's PQ key happens while the classical key is still trusted. After a break, a classical signature proves nothing.
- **P6. Honest claims.** The product reduces loss after the first canaries trip. It does not prevent a loss in the first blocks of an attack. The daily limit and timelock exist to bound that window. Document this plainly.

**Non-goals:** custody by a third party, cross-chain bridging, a wrapped-token variant (roadmap only), formal verification.

## 5. System architecture

```
Bait wallets ──read by──> CanaryRegistry ──alarm flag──> PQVault (clones via VaultFactory)
(keys destroyed)           (k-of-n latch)                  normal mode | alarm mode
                                  ▲                                ▲
                       Watcher bot / anyone              Lifeboat wizard (web)
                                  ▲                                ▲
                       PQGovernance (m-of-n ML-DSA)       PQ client package (browser)
```

Stack (confirm against the starter): Solidity 0.8.x + Foundry; TypeScript strict; Next.js/React front end from `create-qorechain-dapp`; viem-style client compatible with QoreX; Node 20 watcher; the chain's published PQ JS library.

### 5.1 Contracts

Use custom errors, NatSpec on every external function, events for every state change, OpenZeppelin (credited) for `SafeERC20`, `ReentrancyGuard`, `Clones`. Checks-effects-interactions everywhere.

**PQ sizes matter (FIPS 204, ML-DSA-87):** public key 2,592 bytes, signature 4,627 bytes. Never store the full public key. Store `keccak256(pk)` on chain and pass `pk` and `sig` in calldata. Measure `pqcVerify` gas in Phase 0 and design batch sizes around it.

**CanaryRegistry**

- Constants/immutables: `MAX_CANARIES = 16`, `governance` (PQGovernance), `thresholdK`, `toleranceBps` (default 100), `minCooldown`.
- `struct Canary { address addr; uint256 baseline; bytes32 exposureTx; uint64 addedAt; bool retired; }`
- `addCanary(addr, exposureTx)`: governance only, after timelock, records `addr.balance` as baseline.
- `retireCanary(index)`: governance only, after timelock.
- `checkAndTrip()`: **public, permissionless, idempotent.** Counts non-retired canaries with `addr.balance < baseline * (10000 - toleranceBps) / 10000`. If the count is at least `thresholdK`, sets `alarmed = true`, stores `alarmBlock = block.number`, emits `AlarmTripped(drainedIndexes, block)`. **Latching:** once tripped it stays tripped.
- `alarmed()` and `lastAlarmBlock()` views for vaults.
- `resetAlarm(proposal, sigs)`: governance only, after `minCooldown`, requires an evidence hash, emits `AlarmReset`. `lastAlarmBlock` is retained so earlier pending actions stay void.
- Fallback if native balance reads are not possible: see A1.

**PQGovernance** (minimal m-of-n)

- Stores m-of-n `keccak256(pk)` hashes of ML-DSA-87 keys. `execute(action, nonce, deadline, pks[], sigs[])` verifies at least m valid signatures with domain separation (chain id, contract address, nonce, deadline), then queues the action behind a timelock. Actions: add or retire canary, reset alarm, rotate guardian set. Demo deployment uses 2-of-3.
- If time is short, cut to a single PQ admin key with a timelock. Keep the interface identical.

**VaultFactory**

- Deploys EIP-1167 clones of `PQVault`. `createVault(owner, pqPkHash, rescue, policy, bindingProof)` where `bindingProof` is a PQ signature, by the key being registered, over `(owner, pqPkHash, rescue, chainid, factory)` proving possession. The transaction itself is sent by `owner`, so owner and key are bound together. Emits `VaultCreated`.
- Immutable bounds: `MIN_TIMELOCK`, `MIN_COOLING_OFF`. A separate testnet demo deployment may use short bounds and must be labeled as such in the UI and README.

**PQVault** (the PQ-Wrap)

- State: `owner`, `pqPkHash`, `rescue`, `policy` (per-token `dailyLimit`, `timelockDelay`, `coolingOff`), `locked`, `pqNonce`, `pendingWithdrawals`, rolling daily-spend accounting, pending policy changes.
- Assets: native token and any ERC-20 via `SafeERC20`. Reject unsupported token behaviors (rebasing, fee-on-transfer) by measuring balance deltas on deposit. Document this.
- **Mode** = `registry.alarmed()` read in a `try/catch`; failure means alarm mode (P3).
- **Normal-mode classical paths** (all revert if alarmed or `locked`):
  - `withdrawClassical(token, amount, to)`: only within the remaining daily limit.
  - `requestWithdrawal(token, amount, to)` then `executeWithdrawal(id)`: for amounts above the limit, executable only after `timelockDelay`, only if `!alarmed` **and** `registry.lastAlarmBlock() < request.createdAtBlock`.
  - `cancelWithdrawal(id)`: owner or valid PQ signature.
  - `tighten(...)`: lower a limit, raise a delay, or `lock()`.
- **PQ paths (always available):**
  - `withdrawPQ(token, amount, to, deadline, pk, sig)`: verifies `keccak256(pk) == pqPkHash`, then `pqcVerify` over a typed digest `(vault, chainid, pqNonce, token, amount, to, deadline)`, increments `pqNonce`. In alarm mode `to` must equal `rescue`.
  - `announceLoosen(change, pk, sig)` then `applyLoosen(id)` after the timelock: raising limits, shortening delays, changing `rescue`, unlocking.
  - `rotatePQKey(newHash, pk, sig)`: old key signs the new hash, timelocked.
- Defense in depth: `ReentrancyGuard`, no `delegatecall`, no `selfdestruct`, no owner sweep, bounded loops.

### 5.2 Lifeboat (web wizard, optional thin on-chain helper)

Steps, each resumable, with simulation (`eth_call`) before every transaction and a clear on-screen explanation:

1. **Generate the ML-DSA-87 key in the browser.** Show a mandatory backup step (encrypted file download plus a typed confirmation). Store only an encrypted blob in IndexedDB. The key never leaves the device.
2. **Choose policy** from presets: *Conservative* (tiny daily limit, long delay), *Balanced*, *Strict* (all withdrawals need PQ; the canary adds little here and the UI says so). Show the worst-case pre-alarm loss implied by the choice.
3. **Choose the rescue address.** Warn loudly if it is a plain classical address.
4. **Create the vault** via the factory (hybrid-signed binding).
5. **Scan** the connected wallet: native balance, ERC-20 balances from a token list plus user-added tokens, and token approvals.
6. **Test deposit** of a small amount, then verify the vault balance.
7. **Deposit the rest** per asset, with a cooling-off window in which the classical key can still reverse it.
8. **Revoke old approvals** the user selects.
9. **Export a migration report** (JSON, optionally PDF) with addresses, transaction hashes and policy.

### 5.3 Watcher service (`services/watcher`)

- Node 20 + TypeScript. Subscribes to new blocks, reads canary balances, and calls `checkAndTrip()` when the threshold condition holds. Idempotent, with retry and backoff. Holds a funded bot key that has **no privileges**, since the call is permissionless.
- Persists to SQLite: canary snapshots, alarm events, last block. Exposes `GET /status` and `GET /health`.
- Warns (log plus optional webhook or Telegram) on: canary balance change, canary retired, RPC lag, alarm tripped. Alert channels are the first thing to cut under time pressure.
- Dockerfile and a `--once` mode for CI and the demo.

### 5.4 Web app (`apps/web`)

Next.js, TypeScript strict, Tailwind, light and dark mode, responsive, accessible (labels, focus states, contrast), proper loading, empty and error states. QoreX connection through whatever interface the docs specify.

- **Dashboard:** global status banner (Normal / Alarm), canary grid with baseline vs current balance, last-trip info, link to the explorer.
- **My Vaults:** create vault, balances, deposit, mode badge, daily-limit meter, pending withdrawals with countdown and cancel, policy editor (tighten is one click; loosen shows the PQ-signature and timelock flow).
- **Lifeboat:** the wizard from 5.2.
- **Canary Lab:** a guided ceremony to create a new bait wallet in the browser, fund it, expose its public key with one transaction, show the address, then wipe the key from memory, and produce an attestation record for governance to add. Be explicit that destruction cannot be proven, which is why k-of-n exists.
- **Drill (testnet only, labeled "SIMULATION"):** drill canaries whose keys are published. A "Simulate Q-Day" button drains them, the watcher trips the alarm, a classical withdrawal visibly reverts, and a PQ withdrawal to the rescue address succeeds.
- **Docs/Threat model:** an in-app page summarizing section 4, including the limits.
- **Activity log:** decoded events from all contracts.

### 5.5 PQ client package (`packages/pq`)

A thin typed wrapper around the chain's PQ library: `generateKeypair`, `sign`, `verify`, `hashPublicKey`, `buildTypedDigest`, `encryptKeyBlob`, `decryptKeyBlob`. Runs in the browser (WASM if needed) and in Node. Unit-tested with known vectors. If the library cannot run in the browser, use fallback A4.

## 6. Security, testing and audit

- **Foundry tests:** unit, fuzz and **invariant** tests. Required invariants: (a) in alarm mode no classical call can reduce a vault's balance; (b) classical calls never loosen policy; (c) `pqNonce` only increases and signatures never replay across vaults or chains; (d) vault token balance equals deposits minus withdrawals; (e) a tripped alarm never un-trips except through governance reset; (f) a request created before an alarm can never execute after it.
- **Negative tests:** registry revert, malformed signatures, expired deadlines, wrong key hash, reentrancy via malicious ERC-20, dust and zero amounts.
- **Static analysis:** `forge fmt`, `solhint`, Slither with findings triaged in `audit/slither.md`.
- **Two-stage QCAI audit:** follow the rules-page procedure from Phase 0 exactly. Store raw outputs and your fixes in `audit/`, and reference them in the README.
- **Gas report** committed to `docs/gas.md`, including `pqcVerify` cost per path.
- **E2E:** Playwright on the main flows against a local or testnet deployment. CI (GitHub Actions) runs build, lint, `forge test` and the e2e suite where possible.

## 7. Repository layout

```
/contracts        Foundry project (src, test, script)
/apps/web         Next.js app
/services/watcher Node watcher + Dockerfile
/packages/pq      PQ client wrapper
/scripts          deploy, ceremony, drill, seed-demo
/deployments      testnet.json (addresses, block numbers, tx hashes)
/docs             DISCOVERY.md, PROGRESS.md, ARCHITECTURE.md, THREAT_MODEL.md, gas.md
/audit            QCAI outputs, slither.md
AI_USAGE.md  README.md  LICENSE (MIT)  CREDITS section inside README
```

## 8. Phased plan (today is Nov 20, 2026; submission target Dec 2, 12:00 UTC)

Each phase ends with a commit, a `PROGRESS.md` update and a checkpoint report to me.

- **Phase 0, Nov 20 to 21: Discovery.** Scaffold with `create-qorechain-dapp`. Register and run the first hybrid-signed transaction on testnet. Write `docs/DISCOVERY.md` answering every item in section 10 with evidence (links, command output, minimal proof-of-concept contracts). Measure `pqcVerify` gas. Write `docs/ARCHITECTURE.md` adjusted to reality. **Stop and report** if A1, A2 or A3 fail.
- **Phase 1, Nov 21 to 24: Core contracts.** CanaryRegistry, PQVault, VaultFactory with full unit and fuzz tests.
- **Phase 2, Nov 24 to 26: Hardening.** PQGovernance, policy changes with timelocks, invariant suite, Slither, first QCAI audit stage.
- **Phase 3, Nov 26 to 28: Client side.** PQ package, watcher, dashboard, My Vaults.
- **Phase 4, Nov 28 to 30: Lifeboat, Canary Lab, Drill.** E2E tests, error and edge-case polish.
- **Phase 5, Nov 30 to Dec 1: Ship.** Second audit stage, final testnet deployment, README, threat model, demo video, `AI_USAGE.md` finalized.
- **Dec 2 morning: buffer and submit** before 12:00 UTC.

**Cut order if behind (never cut the first four):** keep CanaryRegistry, PQVault, watcher, dashboard and drill. Then cut, in this order: alert channels, PDF report, guardian governance (reduce to one timelocked PQ admin), Canary Lab ceremony UI (script instead), Playwright breadth.

## 9. Deployment, demo and submission

- Deployment scripts are deterministic and write `deployments/testnet.json`. Verify contracts on the explorer if supported. Two deployments if needed: **production-bounds** (real delays) and **demo-bounds** (short delays), each clearly labeled.
- Seed script prepares the demo: funded vault, drill canaries, watcher running.
- **Demo video, at most 3:00, honest and labeled as a simulation:**
  1. 0:00 to 0:20: the problem (keys can fall, no announcement).
  2. 0:20 to 0:50: Lifeboat migration into a vault.
  3. 0:50 to 1:10: normal use, with daily limit and timelock.
  4. 1:10 to 2:10: "Simulate Q-Day": canaries drain, alarm trips, classical withdrawal reverts, PQ withdrawal to the rescue address succeeds.
  5. 2:10 to 2:40: the architecture and the honest limits.
  6. 2:40 to 3:00: where it goes next.
- README must contain: what it is, why, architecture diagram, how to run everything, deployed addresses, threat model summary with limits, test and audit results, credits, license.
- Final checklist: public repo, MIT license, README, video, testnet addresses, `AI_USAGE.md`, project form filled, all team members registered.

## 10. Assumptions register (verify in Phase 0, record in `DISCOVERY.md`)

| ID | Assumption | How to verify | Fallback if false |
| --- | --- | --- | --- |
| A1 | A contract can read `addr.balance` of an arbitrary address on the EVM lane | Minimal contract + test on testnet | Canaries hold an ERC-20 and the registry reads `balanceOf` |
| A2 | `pqcVerify` is callable from Solidity with (pk, message, signature) and returns a bool | Docs + minimal contract | Use the chain's documented helper/precompile; if none exists, stop and report to me |
| A3 | "Scoped EVM window" is a chain feature governing what classical-signed EVM transactions may do | Docs and rules page | Redesign normal-mode paths to match it; report to me |
| A4 | The PQ JS library runs in the browser with ML-DSA-87 keygen and signing | Small Vite test | Local signer CLI the user runs on their own machine; never a hosted signer |
| A5 | QoreX exposes an EIP-1193-style provider for the EVM lane | QoreX docs, starter template | Use QoreX's documented SDK |
| A6 | `pqcVerify` gas fits comfortably in a block, including 2-of-3 governance | Measure | Reduce m, batch less, or move governance to a single PQ admin |
| A7 | Testnet faucet and RPC limits allow the watcher and e2e tests | Try it | Cache reads, back off, run a local node for tests |
| A8 | The explorer supports contract verification | Try it | Publish source and compiler settings in the repo |
| A9 | What the two-stage QCAI audit requires and how it is evidenced | Rules page, docs | Ask in Discord; document the exact steps taken |
| A10 | Partial-drain masking: someone tops up a drained canary before the trip call | Reason and test | Watcher polls every block; document the residual risk |

## 11. Definition of done

- All Phase 0 assumptions resolved with evidence, and any deviation from this prompt written down and approved by me.
- All contracts deployed on testnet, addresses in the README, tests green, invariants passing, audits stored in `audit/`.
- A new user can complete Lifeboat end to end on testnet and see the vault in Normal mode.
- "Simulate Q-Day" reliably trips the alarm, blocks a classical withdrawal, and allows a PQ withdrawal to the rescue address.
- A third party can clone the repo and run the project from the README alone.
- Demo video recorded from the real running product, at most 3 minutes, labeled as a simulation.
- The README and threat model state the limits (section 4, P6) plainly.
