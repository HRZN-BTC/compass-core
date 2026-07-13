# Security & threat model

Compass is a Bitcoin-aware personal finance app. This document states plainly
what Compass can and cannot do to you, what we could theoretically do, and why
we can't. It exists because "trust me" is not an argument.

## What Compass never has

- **Private keys or seed words.** The app never asks for them. Input that looks
  like a private key is rejected outright
  ([`walletValidation.ts`](./packages/core/src/walletValidation.ts) returns
  `looks_like_private_key` and refuses it). Compass cannot spend your bitcoin.
  Ever. It's read-only by construction, not by policy.
- **Your xpub, on our servers (desktop).** Address derivation is BIP32 math run
  on your machine ([`walletDerived.ts`](./packages/core/src/walletDerived.ts)).
  The xpub is stored inside your local encrypted data file and goes nowhere.
- **Your financial data.** Transactions, accounts, goals, net worth — all local.
  See [NETWORK.md](./NETWORK.md) for the complete list of what leaves your device.

## Cryptography in use

| What | How |
|------|-----|
| Local data file at rest | AES-256-GCM |
| Backup exports (`.compass` files) | Argon2id key derivation + AES-256-GCM, passphrase chosen by you |
| License certificates | Ed25519 signatures, verified offline against a public key compiled into the app ([`license.ts`](./packages/core/src/license.ts)) |

## Threat model: what could a malicious HRZN BTC do?

Being honest about the attack surface:

1. **Ship a malicious update.** This is the real trust boundary of any
   auto-updating closed binary — same as your browser, your wallet firmware,
   and your OS. Mitigations: updates are cryptographically signed; the
   security-critical logic is open in this repo so the claimed behavior is
   auditable; and [NETWORK.md](./NETWORK.md) gives you a contract you can
   check with a packet sniffer on every version.
2. **Lie about what the closed UI layer does.** The UI calls into these open
   packages for everything key- and storage-related. If the shipped app
   contradicted this repo, it would be observable at the network layer —
   the one place lying is detectable from outside. That's why the network
   contract above is deliberately short and falsifiable.
3. **Correlate license activations.** During purchase we necessarily learn:
   your email, plan, payment metadata (or a BTCPay invoice if you pay in
   bitcoin), and a random per-install device ID. We never learn your balances,
   addresses, or xpub, so there is nothing financial to correlate it *with*.

## What happens if HRZN BTC disappears tomorrow

Bitcoiners' rational fear isn't theft — it's dependency. So:

- The app keeps working. License verification is offline (Ed25519 against an
  embedded public key), with a 30-day grace period on the periodic re-check.
- Your data is a local file you already control, and `.compass` backups are
  documented here well enough to decrypt independently: Argon2id → AES-256-GCM.
- Balance lookups hit public infrastructure (mempool.space), not our servers.

No server of ours is load-bearing for your data or your funds.

## Scope of this repo

Open here: xpub derivation, wallet validation, encryption/storage providers,
domain schema, license verification, currency/price logic — everything that
touches keys, money math, or your data at rest. Closed: UI, billing, and sync
service. The business model is "charge money, owe you nothing but software" —
no ads, no analytics, no data sales — and the closed layer is what funds
maintenance.

## Reporting a vulnerability

Report privately via [compassbtc.app/contact](https://compassbtc.app/contact).
Include steps to reproduce. Security reports get priority over everything else;
you'll get a response within 72 hours. Please don't open public issues for
unpatched vulnerabilities.
