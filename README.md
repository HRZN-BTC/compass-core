# compass-core

Open-source core packages for [Compass](https://compassbtc.app) — Bitcoin-aware personal finance.

These packages contain the security-critical logic: xpub address derivation, wallet validation, encryption storage, domain schema, and reflection generation. Published openly so anyone can verify the privacy claims Compass makes.

## Packages

### `packages/core`

- **`walletDerived.ts`** — On-device BIP32 xpub derivation (P2PKH / P2SH-P2WPKH / P2WPKH). Your xpub never leaves your device.
- **`walletValidation.ts`** — Validates xpub format, detects private keys, rejects invalid input.
- **`license.ts`** — Ed25519 offline license certificate verification.
- **`reflections/generate.ts`** — Monthly reflection aggregation (spending in sats, accumulation rate).
- **`storage/schema.ts`** — Full data schema for wallets, transactions, goals, accounts, reflections.
- **`currencies.ts`** / **`currency.ts`** / **`price.ts`** — 8-fiat display layer (USD, CAD, AUD, EUR, GBP, INR, JPY, CHF). Storage is always USD; conversion is display-only.
- **`exportCsv.ts`** — CSV export for transactions and net worth.

### `packages/storage`

- **`json.ts`** — AES-256-GCM encrypted JSON file provider (used by Tauri desktop app).
- **`local.ts`** — localStorage provider (browser dev/testing).
- **`index.ts`** — Provider factory.

## Why open source just these?

The privacy question with a financial app is specific: *does my xpub leave my device, and is my data actually encrypted?* Both answers live here. The app layer (UI, billing, sync) stays proprietary — but the code that touches your keys and your data is here for anyone to audit.

## License

MIT — see [LICENSE](./LICENSE).
