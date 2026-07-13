# Every network call Compass makes

This is the complete list of outbound connections from the Compass desktop app.
There are no others. Don't take our word for it — run [Little Snitch](https://www.obdev.at/products/littlesnitch),
[LuLu](https://objective-see.org/products/lulu.html), or Wireshark while using the
app and compare.

## The list

| Host | When it fires | What is sent | What comes back |
|------|---------------|--------------|-----------------|
| `mempool.space` (default — configurable, see below) | Only if you use xpub tracking, when a balance refresh runs | Individual derived **addresses** (`/api/address/{address}`), queried in small batches | Confirmed + unconfirmed balance per address |
| `mempool.space` | Price fallback, only if CoinGecko is unreachable | Nothing but the request (`/api/v1/prices`) | Current BTC price |
| `api.coingecko.com` | Periodically while the app is open | Nothing but the request (one call covers BTC price + all 8 fiat FX rates) | BTC price and FX rates |
| `compassbtc.app` | On license activation, purchase, and a silent re-verification roughly every 25 days | License key, a random per-install device ID, platform name. During purchase only: your email (to send the license key) | A signed license certificate |
| `compassbtc.app` | Update check (`/releases/latest.json`) | Nothing but the request | Latest version manifest |

## What is never sent, to anyone

- Your **xpub**. Address derivation happens on your device
  ([`packages/core/src/walletDerived.ts`](./packages/core/src/walletDerived.ts) — read it).
- Your transactions, accounts, goals, balances, or any financial data.
- Analytics, telemetry, crash reports, usage events. There is no analytics SDK
  in the desktop app. Grep this repo — and the app bundle — for `posthog`,
  `sentry`, `telemetry`, `analytics`. You'll find nothing.

## Honest caveats

- **mempool.space sees your addresses and your IP.** That's inherent to querying
  any public block explorer. Addresses are sent individually (never the xpub, so
  no single request links your whole wallet), but a block explorer could
  correlate by IP and timing. If that's in your threat model you have two outs:
  point Compass at **your own node** (Settings → Bitcoin Data Source accepts any
  Esplora/mempool-compatible API; see
  [`setMempoolEndpoint` in `walletDerived.ts`](./packages/core/src/walletDerived.ts)),
  or use manual balance mode — which makes zero wallet-related network calls at all.
  A VPN or Tor also helps if you stay on the public explorer.
- **Manual mode is fully offline-capable.** Enter your balance by hand and the
  only calls left are price, update check, and the ~25-day license ping (which
  has a 30-day offline grace period).

## Verify it yourself

```bash
# macOS: watch every connection the app opens
sudo lsof -i -a -c Compass

# Or capture with Wireshark and filter:
#   tls.handshake.extensions_server_name
# You should see only: mempool.space, api.coingecko.com, compassbtc.app
```

If you ever observe a connection not on this list, that's a bug or a lie —
report it via [compassbtc.app/contact](https://compassbtc.app/contact) and it
will be treated as a critical security issue.
