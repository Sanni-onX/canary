// Load CosmJS's CommonJS crypto graph before the SDK's parallel ESM imports.
// Node 22.13 otherwise reports ERR_REQUIRE_CYCLE_MODULE with noble's ESM graph.
await import('@cosmjs/crypto');
