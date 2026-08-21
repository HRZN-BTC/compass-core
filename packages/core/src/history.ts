// Historical BTC/USD price series for the Bitcoin tab's chart.
//
// Two keyless upstreams, merged:
//   - blockchain.info charts: uniform DAILY closes since Aug 2010 (~5.8k
//     points, no gaps) — the long-range spine. mempool alone can't serve this:
//     its archive is weekly before 2022, which draws bull runs as straight
//     triangle segments and misses the real peaks.
//   - mempool.space historical-price: HOURLY for the recent tail (last ~month),
//     so 24H/7D/30D have real intraday shape.
// Either source alone still works (degraded) if the other is down.
//
// One fetch serves every timeframe; clients slice + resample locally. The web
// app proxies this through /api/price/history (Next revalidate caching); the
// desktop app calls fetchPriceHistoryUpstream() directly through the injected
// Tauri transport, mirroring how it fetches the live price.
//
// Series stays USD-only — display currency converts at the edge via getFxRate,
// same as every other stored amount.

import { coreFetch } from './transport'

export type PricePoint = { t: number; usd: number } // t = ms epoch, ascending

export type Timeframe = '24H' | '7D' | '30D' | '1Y' | 'ALL'

export const TIMEFRAME_MS: Record<Exclude<Timeframe, 'ALL'>, number> = {
  '24H': 24 * 60 * 60 * 1000,
  '7D': 7 * 24 * 60 * 60 * 1000,
  '30D': 30 * 24 * 60 * 60 * 1000,
  '1Y': 365 * 24 * 60 * 60 * 1000,
}

// Points per rendered chart line. Every timeframe resamples to exactly this
// count so timeframe transitions can lerp point-for-point.
export const CHART_POINTS = 240

const MEMPOOL_HISTORY = 'https://mempool.space/api/v1/historical-price?currency=USD'
const BLOCKCHAIN_DAILY = 'https://api.blockchain.info/charts/market-price?timespan=all&format=json&sampled=false'

// Where the daily spine hands off to the hourly tail. Wide enough that the 30D
// view is fully hourly.
const HOURLY_TAIL_MS = 32 * 24 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

// Last successful fetch, kept so a failed refresh (or the API route's error
// path) can serve slightly stale data instead of an empty chart.
let lastGoodHistory: PricePoint[] | null = null

export const getLastGoodHistory = (): PricePoint[] | null => lastGoodHistory

async function fetchMempoolHourly(): Promise<PricePoint[]> {
  const res = await coreFetch(MEMPOOL_HISTORY, { revalidate: 3600 })
  if (!res.ok) throw new Error(`mempool history ${res.status}`)
  const j = await res.json()
  const raw: Array<{ time: number; USD: number }> = j?.prices ?? []
  const points: PricePoint[] = []
  for (const p of raw) {
    const t = Number(p.time) * 1000
    const usd = Number(p.USD)
    if (t > 0 && usd > 0) points.push({ t, usd })
  }
  if (points.length === 0) throw new Error('mempool history empty')
  points.sort((a, b) => a.t - b.t)
  return points
}

async function fetchBlockchainDaily(): Promise<PricePoint[]> {
  const res = await coreFetch(BLOCKCHAIN_DAILY, { revalidate: 3600 })
  if (!res.ok) throw new Error(`blockchain.info charts ${res.status}`)
  const j = await res.json()
  const raw: Array<{ x: number; y: number }> = j?.values ?? []
  const points: PricePoint[] = []
  for (const p of raw) {
    const t = Number(p.x) * 1000
    const usd = Number(p.y)
    if (t > 0 && usd > 0) points.push({ t, usd })
  }
  if (points.length === 0) throw new Error('blockchain.info charts empty')
  points.sort((a, b) => a.t - b.t)
  return points
}

export async function fetchPriceHistoryUpstream(): Promise<PricePoint[]> {
  const [dailyRes, hourlyRes] = await Promise.allSettled([fetchBlockchainDaily(), fetchMempoolHourly()])
  const daily = dailyRes.status === 'fulfilled' ? dailyRes.value : null
  const hourly = hourlyRes.status === 'fulfilled' ? hourlyRes.value : null
  if (!daily && !hourly) {
    throw (dailyRes as PromiseRejectedResult).reason ?? new Error('all history sources failed')
  }
  let points: PricePoint[]
  if (daily && hourly) {
    const cutoff = Date.now() - HOURLY_TAIL_MS
    points = [...daily.filter((p) => p.t < cutoff), ...hourly.filter((p) => p.t >= cutoff)]
  } else {
    points = (daily ?? hourly)!
  }
  lastGoodHistory = points
  return points
}

// One point per UTC day (last sample wins). Long timeframes collapse to this
// before LTTB so the index-bucketed resampler spreads its buckets evenly in
// time — otherwise the dense hourly tail hogs most buckets and the early years
// flatten into straight segments.
function collapseDaily(points: PricePoint[]): PricePoint[] {
  const out: PricePoint[] = []
  let curDay = -1
  for (const p of points) {
    const day = Math.floor(p.t / DAY_MS)
    if (day !== curDay) {
      out.push(p)
      curDay = day
    } else {
      out[out.length - 1] = p
    }
  }
  return out
}

export function sliceTimeframe(points: PricePoint[], tf: Timeframe, nowMs = Date.now()): PricePoint[] {
  if (tf === 'ALL') return collapseDaily(points)
  const cutoff = nowMs - TIMEFRAME_MS[tf]
  // Points are ascending; binary-search the first index inside the window.
  let lo = 0
  let hi = points.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (points[mid].t < cutoff) lo = mid + 1
    else hi = mid
  }
  const sliced = points.slice(lo)
  return tf === '1Y' ? collapseDaily(sliced) : sliced
}

// Resample to exactly `n` points: largest-triangle-three-buckets when the input
// is longer (keeps spikes a naive stride would skip), linear interpolation up
// when shorter (a 24H slice of hourly data is only ~25 points).
export function resamplePoints(data: PricePoint[], n = CHART_POINTS): PricePoint[] {
  if (data.length === 0) return []
  if (data.length === n) return data.slice()
  if (data.length < n) {
    const out: PricePoint[] = []
    for (let i = 0; i < n; i++) {
      const f = (i / (n - 1)) * (data.length - 1)
      const j = Math.floor(f)
      const g = f - j
      const a = data[j]
      const b = data[Math.min(j + 1, data.length - 1)]
      out.push({ t: a.t + (b.t - a.t) * g, usd: a.usd + (b.usd - a.usd) * g })
    }
    return out
  }
  const out: PricePoint[] = [data[0]]
  const bucket = (data.length - 2) / (n - 2)
  let anchor = 0
  for (let i = 0; i < n - 2; i++) {
    const avgStart = Math.floor((i + 1) * bucket) + 1
    const avgEnd = Math.min(Math.floor((i + 2) * bucket) + 1, data.length)
    let avgT = 0
    let avgP = 0
    for (let j = avgStart; j < avgEnd; j++) {
      avgT += data[j].t
      avgP += data[j].usd
    }
    const count = avgEnd - avgStart || 1
    avgT /= count
    avgP /= count
    const rangeStart = Math.floor(i * bucket) + 1
    const rangeEnd = Math.floor((i + 1) * bucket) + 1
    let best = rangeStart
    let bestArea = -1
    for (let j = rangeStart; j < rangeEnd; j++) {
      const area = Math.abs(
        (data[anchor].t - avgT) * (data[j].usd - data[anchor].usd) -
          (data[anchor].t - data[j].t) * (avgP - data[anchor].usd),
      )
      if (area > bestArea) {
        bestArea = area
        best = j
      }
    }
    out.push(data[best])
    anchor = best
  }
  out.push(data[data.length - 1])
  return out
}
