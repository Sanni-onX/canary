# Canary Stage 2 review packet — 23 November 2026

Setting: Ethereum (EVM/Solidity), same as Stage 1. Network: Diana testnet.
Submit `Canary.flattened.sol` from this directory. It compiles with solc 0.8.28.
SHA-256: b91643999e7edc02be8fb15a6fe4c5a98c15684d3c9d54f00f76119386a71069.

Stage 1 report: `docs/audit/2026-11-21-stage-1.pdf` (72/100, medium).
All five findings were reviewed against the actual source. No executable
contract change is warranted by these findings. The revised bundle adds
explicit comments explaining the existing defenses; two additional regressions
now prove copied-proof front-running rejection and the 16-slot cap.

| Stage 1 item | Response and verification |
| --- | --- |
| HIGH: withdrawPQ lacks reentrancy guard | Already `external nonReentrant`. `testReentrancyCannotUseAnOtherwiseValidNextPQAuthorization` attempts a callback with a valid next-nonce proof; it cannot withdraw. |
| MEDIUM: rolling spending can overflow | Solidity 0.8.28 checked arithmetic is active. Budget checks use subtraction after checking used <= limit. Fuzz coverage: `testFuzzClassicalAuthorityNeverExceedsRollingBudget`; storage capacity: `testRollingTransferStorageBoundFailsClosed`. Overflow cannot silently wrap. |
| MEDIUM: creation front-running | Sender must equal owner before nonce mutation. `testAuditCopiedCreationProofCannotConsumeOwnerNonce` copies a valid proof, verifies the attack fails without nonce consumption, verifies the owner succeeds, then rejects replay. |
| LOW: unbounded security-state loop | addCanary caps length at 16; replacement reuses slots. `testAuditRegistryRejectsSeventeenthSlot` and `testRepeatedEpochRotationKeepsSixteenSlotsAndReadiness` prove the bounds. |
| INFO: ERC-165 absent | No claimed ERC-165 or NFT receiver interfaces. QOR/ERC-20 custody does not require ERC-165; no interface claim added. |

Validation: 29 core/rotation tests passed on 23 November. Both coverage tests
and both watcher integration tests passed. Full historic invariant evidence is
in docs/AUDIT.md. These tests use verifier mocks for authorization plumbing;
actual chain PQ verification has separate transaction evidence.

Stage 2 has NOT been submitted or completed by preparing this packet. Save the
actual second report under docs/audit/ and map any new findings before closure.
