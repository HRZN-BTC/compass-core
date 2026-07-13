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
export const FALLBACK_BTC_PRICE = 98240
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

const COINGECKO =
  'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin' +
  `&vs_currencies=${CURRENCY_CODES.join(',').toLowerCase()}` +
  '&include_24hr_change=true'
const MEMPOOL = 'https://mempool.space/api/v1/prices'

// Server-side memory of the last successful multi-currency fetch, used to
// splice INR into the mempool fallback (mempool covers the other seven but not
// INR). Lost on cold start — FALLBACK_FX covers that.
let lastGoodUpstream: FiatPrices | null = null

// Server-side upstream fetch. The `next.revalidate` caches the upstream call so
// traffic never hammers CoinGecko regardless of how many requests hit /api/price.
export async function fetchBtcPriceUpstream(): Promise<BtcPrice> {
  try {
    const res = await coreFetch(COINGECKO, { revalidate: 60 })
    if (!res.ok) throw new Error(`coingecko ${res.status}`)
    const j = await res.json()
    const prices: FiatPrices = {}
    for (const code of CURRENCY_CODES) {
      const v = Number(j.bitcoin[code.toLowerCase()])
      if (v > 0) prices[code] = v
    }
    if (!prices.USD) throw new Error('coingecko missing usd')
    lastGoodUpstream = prices
    return {
      usd: prices.USD,
      change24h: Number(j.bitcoin.usd_24h_change ?? 0),
      fetchedAt: Date.now(),
      prices,
    }
  } catch (err) {
    const res = await coreFetch(MEMPOOL, { revalidate: 60 })
    if (!res.ok) throw err
    const j = await res.json()
    const usd = Number(j.USD)
    const prices: FiatPrices = {}
    for (const code of CURRENCY_CODES) {
      const v = Number(j[code])
      if (v > 0) prices[code] = v
    }
    // mempool has no INR: carry the FX rate from the last good CoinGecko fetch
    // (scaled to the fresh USD price) so INR users degrade to a slightly stale
    // rate instead of snapping to the seed.
    if (!prices.INR && lastGoodUpstream?.INR && lastGoodUpstream.USD) {
      prices.INR = usd * (lastGoodUpstream.INR / lastGoodUpstream.USD)
    }
    return { usd, change24h: 0, fetchedAt: Date.now(), prices }
  }
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
