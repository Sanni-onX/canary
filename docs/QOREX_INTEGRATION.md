# QoreX-only integration investigation — 20 November 2026

## Later 21 November: session test explicitly deferred

Current docs still list QoreX EVM sending as unsupported. A concrete candidate
test using a fresh owner, separate relay, one-hour EVM-only key, 0.1-test-QOR
cap and factory-only scope was prepared. Automatic review required approval for
the account-rule change; the human chose **Skip session testing for now**.
The unexecuted experiment was removed. No account rule/session was changed.
Wallet sends remain gated. Public reads, local key recovery and preflight-checked
public authorizations do not claim this unverified route is usable in QoreX.

## 21 November: later human steering and successful deployment route

Human now has QoreX extension as well as mobile, asked to prioritize the product,
and offered keys if necessary. No personal secret was requested/provided.
Instead a fresh local testnet-only account was generated; human funded it with
5 test QOR. It registered its PQ key, opened bounded/target-scoped windows and
deployed the core. Real PQ governance, watcher alarm and vault rescue succeeded.

This solves the **builder deployment** path without adding a wallet app. It
does not prove QoreX supports unsupported EVM sends or a QR handshake, and it
does not complete general-user live migration. The current product has native
QoreX connection, a clearly labeled interactive simulation and actual read-only
testnet dashboard. Historical mobile-only investigation follows below.

## Human constraint

Use QoreX **mobile only**. Do not require MetaMask, another wallet, secret export
or a hosted user signer. The human has not approved creating a linked session
key or changing account rules. No such transactions have been built or sent.

## Verified account

Native: `qor1wlxxvzrqpmcrqkqhc2la7jgs7yce58mrjpr86z`.
Canonical EVM encoding: `0x77cc6608600ef0305817c2bfdf4910f1319a1f63`.

- Balance: 49.865 test QOR at the saved observation time.
- ML-DSA-87 registered, proof of possession true.
- EVM authorisation window: absent.
- Abstract-account module: enabled on testnet; this account's abstract-account
  record was not found. No session permissions should be inferred from that.
- Existing successful native transfer at height 10,454,410 has
  `pqc_hybrid_verify` with `status=verified` for this exact account:
  `F6A6EB9E038C2F8FC4B6880353CA34FDB03D9932ED1777C9A12F0B36AE8E6A97`.
  This is human account history, not a Canary-initiated transaction. The earlier
  key registration was classical bootstrap; it is not labeled hybrid proof.

Sources: `evidence/account.json` and `evidence/account-transactions.json`.
Do not assume the wallet's separately derived EVM account has this address;
the native and EVM derivation paths can differ. Encoding one native account's
20 bytes is not the same as deriving the wallet's coin-60 account.

## Options assessed

| Route | Finding | Decision |
| --- | --- | --- |
| QoreX mobile `eth_sendTransaction` | Mobile guide explicitly describes EVM as read-only. Native `signAndBroadcast` is supported. | Do not invent support or automatically send a probe transaction. |
| QoreX `signArbitrary` for a PQ payload | FAQ documents a newer message-signing capability, while mobile/integration guides say unsupported. Signatures, when available, cover prefixed bytes rather than raw digest bytes. | Feature-detect installed wallet later. Do not make this the only recovery path. Browser-local vault PQ keys remain in the original product scope. |
| QoreX native session-key EVM execution | Chain documents `MsgRegisterAuthenticator`, spending rules, `MsgExecuteEVM`, per-key nonces and hybrid relayer envelopes. Could allow a browser-generated, tightly scoped classical session key without another wallet app. | **Candidate only.** Wallet decoding support and relay topology are unverified; do not enable or promise it works. |
| Native `MsgEthereumTx` wrapper | A native envelope does not manufacture the required Ethereum transaction signature. QoreX's native broadcast helper does not promise this signing method. | Not a verified workaround. |
| Export QoreX recovery material to CLI | Would defeat the chosen wallet-only workflow and introduce unnecessary secret handling. | Not selected. |
| New browser-owned full account | Would introduce a second wallet implementation, not preserve the human's selected workflow. | Not selected. |

The public core tree exposes abstract-account message types/policy helpers but
the keeper is a community stub; it cannot prove the production handler's
self-relay behavior. The SDK guide describes a separate relayer. A same-account
relay therefore must not be assumed. QoreX's public provider repository exposes
only a README; wallet message decoder support cannot be established from it.

## Conditions before enabling the candidate

1. Verify actual QoreX mobile capabilities and its decoded support for the
   exact link/rule/execution messages. Unknown-message refusal must remain intact.
2. Prove the relay topology works without exporting the user's PQ secret. If a
   separate relayer is necessary, review the signing and availability model.
3. Define target/selector scope, small nonzero spend caps, bounded token denoms,
   short expiry and immediate revocation. Preserve existing rules when updating:
   the SDK warns rule updates replace the entire set.
4. Verify proof of session-key possession and exact chain-required digest.
   Both execution lanes use **per-authenticator nonce**, not EVM nonce. Handle
   `success=false` even inside a code-0 native transaction; v3.2.8 can burn nonce
   on failed execution.
5. Keep vault ownership binding unchanged: the factory must see the intended
   owner address as `msg.sender`, or the design needs explicit review/approval.
6. Session execution bypasses the ordinary EVM-window gate. The fest's scoped
   window requirement is still separate and must be evidenced honestly.
7. Obtain human approval for the concrete account-permission changes before any
   session setup is signed. The instruction to investigate is not such approval.

## Discovery console

`apps/web` is a minimal Next.js discovery page, not the finished dashboard.
It has public account reads, QoreX connection/capability inspection and real
browser ML-DSA-87 keygen/sign/verify with an unfunded ephemeral key. There is no
`signAndBroadcast`, EVM send or account-rule mutation in the page.

Run `npm run dev` and open http://127.0.0.1:3000 on the development computer.
QoreX mobile connects only to **HTTPS**, so localhost is not a phone test link.
A secure hosted preview is still needed for testing the actual mobile wallet.
Desktop Chromium with a mobile viewport is not evidence of QoreX/iOS/Android
wallet execution. The real mobile step remains pending.

The temporary browser key is never stored or uploaded; buffer clearing is only
best effort. It is not the user's registered account PQ key or a vault key.

## Sources

- https://docs.qorechain.io/qorex/dapp-browser/
- https://docs.qorechain.io/developer-tools/qorex-integrations/
- https://docs.qorechain.io/sdk/guides/authenticators/
- https://docs.qorechain.io/developer-guide/evm-window-reference/
- https://build.qorechain.io/faq
- https://github.com/qorechain/qorechain-core/tree/main/x/abstractaccount
- Installed `@qorechain/sdk@0.14.0` declarations for messages, nonce rules,
  `linkAuthenticatorMsgs`, and `searchTxs`.

Version listings in official pages differ (integration guide discusses 0.3.x;
workshop kits list extension 0.4.2/mobile 1.2.3). Test installed capabilities;
do not use an older documentation version label as a runtime verdict.

Local tooling note: importing the full SDK directly in Node 22.13.1 produced
`ERR_REQUIRE_CYCLE_MODULE` through CosmJS's CommonJS require of noble ESM.
The public-account utilities use the documented REST endpoints directly. The
retained CLI window helper has only been typechecked, not runtime-validated;
it is not part of the selected mobile-only signing route.
