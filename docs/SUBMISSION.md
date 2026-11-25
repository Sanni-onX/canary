# Canary submission packet

Category: Post-Quantum dApp. New Canary code is MIT licensed.

## Description

Canary is a testnet early-warning and recovery system for classical-key
compromise. A threshold of depleted bait accounts latches an alarm that freezes
classical withdrawals from PQ-Wrap vaults, while separately authorized
ML-DSA-87 rescue remains available. Lifeboat guides backup creation, vault
discovery, deposits, approval review and recovery.

## How it is made

Solidity vaults, an immutable clone factory, bounded canary registry and
timelocked PQ governance run on Diana. PQ authorizations bind chain, contract,
action, nonce and deadline. The Next.js app performs local ML-DSA key handling
and encrypted recovery backups. A persistent Railway watcher reads canaries
and uses a dedicated PQ-registered bot to submit native hybrid alarm calls.
Coverage is finite: replacement deadlines are monitored and fresh epochs use
local PQ-governed slot replacement. QoreX transaction controls use native
signAndBroadcast and cross-VM calls; installed-wallet approval remains an
explicit verification gap, not a claimed completed end-user migration.

Both QCAI EVM reviews scored 72/100. The original PDFs and every finding's
disposition are in docs/audit/ and docs/AUDIT.md. Automated QCAI reviews are
not independent security audits. AI assistance and open-source credits are
documented in AI_USAGE.md and README.md.

## Links and evidence

- App: https://web-production-2863d083.up.railway.app/?mode=testnet
- Public source: https://github.com/Sanni-onX/canary
- Fest project: https://build.qorechain.io/p/canary
- Hosted CI passed: https://github.com/Sanni-onX/canary/actions/runs/45580593618
- Watcher: https://watcher-production-64b80e30.up.railway.app/status
- Active addresses/receipts: deployments/testnet-v2.json
- Automatic alarm: docs/evidence/automatic-alarm-test.json
- PQ withdrawal and native call/deposit: deployment manifest and docs/evidence/
- Audit findings and responses: docs/AUDIT.md
- Cover: docs/images/cover.png
- Protocol preview: docs/demo/canary-protocol-demo.mp4; full migration recording remains pending. Captioned simulation plus separate live testnet evidence;
  do not describe the simulation as wallet-signed fund movement.

Keep the registered QoreX address linked. Add build accounts to the project:

- Registered: qor1wlxxvzrqpmcrqkqhc2la7jgs7yce58mrjpr86z
- Dashboard coin-60: qor1z84y95u0t2zmm3a46f5pmy2k2qtcxdp502m5r3
- Deployment operator: qor1mqfp8mfhqwpf8sc26850r94qarahf4ryfjvdpp
- Alarm bot: qor1st9rkt8535uejhwcdau4nw3zesafdhkqparqnv

## Before submission

The public project now links the repository, live app, protocol-preview MP4
and four verified testnet addresses. Category is Post-Quantum dApp and AI-Native
is verified; only used kits/features were declared. The fest generated a cover
because browser file upload could not open the local chooser. Hosted CI passed
for be9e0f6. The user completed GitHub authentication and installed QoreChain
Build with read access scoped to Sanni-onX/canary. After the subsequent push,
My space verified one counted commit and the PQC-check contract badge was
earned. The original public audit PDFs match the local originals byte-for-byte.

Record a real QoreX mobile approval result and replace the preview with a full
mobile migration demonstration if available. Review finite coverage and alarm
status immediately before a live demonstration. No Q-Day Survivor participation
is claimed. The project remains editable until the official deadline; there is
no separate final submit button according to the current Start page.

Official procedure checked 25 November 2026:
https://build.qorechain.io/start and https://build.qorechain.io/faq .
