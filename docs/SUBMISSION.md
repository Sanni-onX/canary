# Submission checklist

Verified 21 November 2026 against https://build.qorechain.io/faq,
https://build.qorechain.io/start and https://build.qorechain.io/rules.

## Addresses to list on Canary's project page

- Registered QoreX account: `qor1wlxxvzrqpmcrqkqhc2la7jgs7yce58mrjpr86z`.
- Fresh local testnet deployer: `qor1mqfp8mfhqwpf8sc26850r94qarahf4ryfjvdpp`.
  EVM encoding: `0xd81213Ed37038293c30aD1e8f196a0E8Fb74D464`.
  Human funded it with 5 test QOR on 21 November. No user secret was supplied.

The registration wallet does **not** have to deploy every contract. The FAQ's
"Which addresses are checked?" says checks use every address on the project
page plus the linked QoreX address. It explicitly instructs builders to add
the addresses they actually use, then press Check again. A transaction from
an unlisted address does not count for those checks. Keep the registered
wallet linked; add this deployment account rather than replacing it.

Adding the deployer on the project page has not yet been observed or confirmed.
Actual contract addresses and successful receipts are now recorded in
`deployments/testnet.json`; the complete testnet drill is in
`docs/evidence/live-drill.json`. The 1600×900 cover is `docs/images/cover.png`.

## Remaining delivery items

- Public original-work repository with MIT license and credits.
- README with real deployment addresses, tests, limitations and audit links.
- Scoped EVM window evidence and actual pqcVerify use.
- Dated QCAI Stage 1/2 PDFs and finding response mapping.
- Featured cover, working video at most 3 minutes, AI_USAGE.md.
- Every team member registered; project form lists all testnet addresses/kits.
- Target submission: 2 December 2026, 12:00 UTC / 13:00 Lagos.
