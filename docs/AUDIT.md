# Audit status

No external audit has been run. Contracts are not ready for custody.

Follow https://build.qorechain.io/faq using the same EVM/Solidity setting for
both QCAI stages. EVM quantum readiness showing Not scored is expected.

Store dated Stage 1 and Stage 2 PDFs in `docs/audit/`, preserve raw outputs in
`audit/`, and map **every** Stage 1 finding here to a fix and named regression
test, or a justified false positive/no-change disposition. Link this page from
the README and the project's How it's made field.

## Current PQ verification surface

`contracts/src/DiscoveryProbe.sol` calls the real `pqcVerify` using the documented
ABI. It holds no funds. Tests check missing verifier output, wrong key and
signature lengths, native balances, and ABI plumbing using a test-only mock.
`scripts/discovery.mjs` separately checks real valid/invalid signatures against
the public testnet precompile. No deployed vault or governance protection exists
at this checkpoint.
