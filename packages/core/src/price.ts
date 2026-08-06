// Single source of truth for the live BTC price across the web app.
//
// Server: /api/price proxies CoinGecko (mempool.space fallback) and caches the
// upstream fetch (mirrors mobile src/lib/services/btcPrice.ts). Clients call
// useBtcPrice() once near the root; it polls /api/price and pushes the value
// into the module-scoped `liveUsd` below. The per-page money helpers read that
// value at call time, so existing zero-arg call sites (usdToSats(usd), …) keep
// working and pick up the live price without threading it through.
//
// Multi-currency: the upstream fetch asks CoinGecko for the BTC price in every
// supported fiat at once (one cached response serves all users — never key the
// fetch by currency). The implied FX rate for a currency is
// prices[code] / prices.USD; getFxRate() resolves live → last-good → seed.
// All stored amounts remain USD; FX only converts at the display/input edge
// (see lib/currency.ts).

import { CURRENCY_CODES, FALLBACK_FX, type CurrencyCode } from './currencies'
import { coreFetch } from './transport'

export const SATS_PER_BTC = 1e8

// Last-resort price used until the first fetch resolves (and if every upstream
// fails). Keep this the ONLY hardcoded BTC price in the codebase.
export const FALLBACK_BTC_PRICE = 64000
export const FALLBACK_CHANGE_PCT = 0.6

export type FiatPrices = Partial<Record<CurrencyCode, number>>

export type BtcPrice = {
  usd: number
  change24h: number
  fetchedAt: number
  // BTC price in each supported fiat. Optional so pre-multi-currency cached
  // responses stay parseable; consumers fall through to getFxRate()'s tiers.
  prices?: FiatPrices
}

// Module-scoped live values. Reassigned by setBtcPrice(); the helpers/getters
// below close over the bindings, so every read reflects the latest fetch.
let liveUsd = FALLBACK_BTC_PRICE
let liveChange = FALLBACK_CHANGE_PCT
let livePrices: FiatPrices = {}
// FX per currency (units per USD) from the most recent fetch that included it.
// Kept separately from livePrices so a mempool fallback (which lacks INR)
// doesn't wipe a previously known INR rate.
const lastGoodFx: Partial<Record<CurrencyCode, number>> = {}
// Stays false until the first real fetch lands. The UI uses this to show a
// skeleton instead of the FALLBACK seed (don't render a fake price as if live).
let priceReady = false

export const getBtcPrice = () => liveUsd
export const getBtcChange = () => liveChange
export const isBtcPriceReady = () => priceReady

// BTC price in the given fiat (for showing "1 BTC = ₹…"). Derived from the
// live USD price and the resolved FX rate so it stays coherent even when the
// last fetch didn't include this currency.
export const getBtcPriceIn = (code: CurrencyCode) => liveUsd * getFxRate(code)

// Units of `code` per USD. Resolution: live fetch → last-good cached rate
// (survives a mempool fallback that lacks the currency) → build-time seed.
export function getFxRate(code: CurrencyCode): number {
  if (code === 'USD') return 1
  const live = livePrices[code]
  const liveUsdPrice = livePrices.USD
  if (live && liveUsdPrice) return live / liveUsdPrice
  return lastGoodFx[code] ?? FALLBACK_FX[code]
}

export function setBtcPrice(p: { usd?: number; change24h?: number; prices?: FiatPrices }) {
  if (typeof p.usd === 'number' && p.usd > 0) {
    liveUsd = p.usd
    priceReady = true
  }
  if (typeof p.change24h === 'number') liveChange = p.change24h
  if (p.prices && typeof p.prices.USD === 'number' && p.prices.USD > 0) {
    livePrices = p.prices
    for (const code of CURRENCY_CODES) {
      const v = p.prices[code]
      if (typeof v === 'number' && v > 0) lastGoodFx[code] = v / p.prices.USD
    }
  }
}

const VS = CURRENCY_CODES.join(',').toLowerCase()
const COINGECKO =
  `https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=${VS}&include_24hr_change=true`
const BLOCKCHAIN = 'https://blockchain.info/ticker'
const MEMPOOL = 'https://mempool.space/api/v1/prices'
const COINBASE = 'https://api.coinbase.com/v2/prices/BTC-USD/spot'

// Server-side memory of the last successful multi-currency fetch. Used to splice
// missing fiats (e.g. INR, which mempool lacks; or every non-USD fiat when the
// only reachable source is a USD-only exchange) at a slightly stale FX rate
// scaled to the fresh USD price. Lost on cold start — FALLBACK_FX covers that.
let lastGoodUpstream: FiatPrices | null = null

// Ordered chain of free, keyless BTC price sources. Each returns a normalized
// BtcPrice or throws; fetchBtcPriceUpstream() walks the chain and takes the
// first that yields a positive USD. Ordering = best data first:
//   1. CoinGecko    — all 8 fiats + real 24h change (but rate-limits hard).
//   2. blockchain.info — all 8 fiats incl INR, no 24h change.
//   3. mempool.space   — 7 fiats (no INR), no 24h change.
//   4. Coinbase        — USD only; ultra-reliable last resort.
// Sources 3–4 rely on spliceMissingFiats() to backfill absent currencies.

async function fromCoinGecko(): Promise<BtcPrice> {
  const res = await coreFetch(COINGECKO, { revalidate: 60 })
  if (!res.ok) throw new Error(`coingecko ${res.status}`)
  const j = await res.json()
  const prices: FiatPrices = {}
  for (const code of CURRENCY_CODES) {
    const v = Number(j.bitcoin[code.toLowerCase()])
    if (v > 0) prices[code] = v
  }
  if (!prices.USD) throw new Error('coingecko missing usd')
  return { usd: prices.USD, change24h: Number(j.bitcoin.usd_24h_change ?? 0), fetchedAt: Date.now(), prices }
}

async function fromBlockchainInfo(): Promise<BtcPrice> {
  const res = await coreFetch(BLOCKCHAIN, { revalidate: 60 })
  if (!res.ok) throw new Error(`blockchain.info ${res.status}`)
  const j = await res.json()
  const prices: FiatPrices = {}
  for (const code of CURRENCY_CODES) {
    const v = Number(j[code]?.last)
    if (v > 0) prices[code] = v
  }
  if (!prices.USD) throw new Error('blockchain.info missing usd')
  return { usd: prices.USD, change24h: 0, fetchedAt: Date.now(), prices }
}

async function fromMempool(): Promise<BtcPrice> {
  const res = await coreFetch(MEMPOOL, { revalidate: 60 })
  if (!res.ok) throw new Error(`mempool ${res.status}`)
  const j = await res.json()
  const usd = Number(j.USD)
  if (!(usd > 0)) throw new Error('mempool missing usd')
  const prices: FiatPrices = {}
  for (const code of CURRENCY_CODES) {
    const v = Number(j[code])
    if (v > 0) prices[code] = v
  }
  return { usd, change24h: 0, fetchedAt: Date.now(), prices }
}

async function fromCoinbase(): Promise<BtcPrice> {
  const res = await coreFetch(COINBASE, { revalidate: 60 })
  if (!res.ok) throw new Error(`coinbase ${res.status}`)
  const j = await res.json()
  const usd = Number(j?.data?.amount)
  if (!(usd > 0)) throw new Error('coinbase missing usd')
  return { usd, change24h: 0, fetchedAt: Date.now(), prices: { USD: usd } }
}

const SOURCES: Array<() => Promise<BtcPrice>> = [
  fromCoinGecko,
  fromBlockchainInfo,
  fromMempool,
  fromCoinbase,
]

// Backfill any fiat a partial source didn't provide, using the last good
// multi-currency fetch's FX ratio scaled to this fetch's fresh USD price. Keeps
// INR (and, for USD-only sources, every other fiat) at a slightly stale rate
// instead of snapping to the build-time seed.
function spliceMissingFiats(p: BtcPrice): BtcPrice {
  if (!lastGoodUpstream?.USD) return p
  const prices: FiatPrices = { ...p.prices }
  for (const code of CURRENCY_CODES) {
    const cached = lastGoodUpstream[code]
    if (!prices[code] && cached) prices[code] = p.usd * (cached / lastGoodUpstream.USD)
  }
  return { ...p, prices }
}

// Server-side upstream fetch. Each source's `next.revalidate` caches its call so
// traffic never hammers any one provider regardless of how many requests hit
// /api/price. Walks the source chain; first positive USD wins.
export async function fetchBtcPriceUpstream(): Promise<BtcPrice> {
  let lastErr: unknown
  for (const source of SOURCES) {
    try {
      const p = await source()
      if (!(p.usd > 0)) continue
      // Remember a full multi-fiat fetch so USD-only fallbacks can be spliced.
      if (p.prices && p.prices.USD && Object.keys(p.prices).length >= CURRENCY_CODES.length) {
        lastGoodUpstream = p.prices
      }
      return spliceMissingFiats(p)
    } catch (err) {
      lastErr = err
    }
  }
  throw lastErr ?? new Error('all btc price sources failed')
}

// Client-side: read our cached /api/price and update the module live value.
export async function refreshBtcPrice(signal?: AbortSignal): Promise<BtcPrice | null> {
  try {
    const res = await fetch('/api/price', { signal })
    if (!res.ok) throw new Error(`price ${res.status}`)
    const j = (await res.json()) as BtcPrice
    setBtcPrice(j)
    return j
  } catch {
    return null
  }
}
