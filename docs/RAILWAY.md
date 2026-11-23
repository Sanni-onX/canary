# Railway release

## Live testnet beta, 2026-11-21

Project: `da648595-e82a-4737-829f-ed958ca08bf6`.
Web: https://web-production-2863d083.up.railway.app
Watcher: https://watcher-production-64b80e30.up.railway.app/health

Public web and `/api/protocol` returned HTTP 200. Watcher `/health` returned
healthy with fresh Diana blocks, no RPC error and `submitterConfigured=false`.
It accurately reports the historical revision-1 alarm and degraded expired
canary coverage. This deployment does not constitute revision-2 activation.
Watcher has a persistent `/data` Railway volume; web explicitly uses PORT=3000.
Current services use CLI source uploads, not GitHub autodeploys.

Create two services from the repository root (do not set a subdirectory root).
Use `/railway.web.json` for web and `/railway.watcher.json` for watcher as the
service's custom config file. Both builds use the existing Dockerfiles.

Generate a public domain for web. Keep watcher continuously running with one
replica and serverless/sleep disabled. Attach a persistent volume to watcher
at `/data`; its SQLite database is `/data/canary-watcher.sqlite`.

Set watcher `CANARY_REGISTRY_ADDRESS` to the verified release registry.
The currently deployed revision-1 address is
`0x3a6d15b3cf0b65c5e6db6217d353508136988ec9`.
Do not label it revision 2. The Dockerfile sets `WATCHER_HOST=0.0.0.0`;
the process honors Railway's injected `PORT`.

No signing secret is needed for read-only monitoring. Without an explicitly
configured dedicated submitter, the watcher reports detections but does not
submit alarm transactions. Never upload `.local`, recovery phrases or user PQ
keys. Docker context exclusions cover local secrets and generated databases.

After deployment verify web `/` and the live testnet workspace, watcher
`/health` and `/status`, registry address, fresh block/coverage state, and database
persistence after a watcher redeploy. Stage 2, revision-2 deployment and wallet
transaction checks are independent release gates, not satisfied by hosting.
