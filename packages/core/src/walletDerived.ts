// mempool.space/Esplora balance resolver — the per-address HTTP fallback.
//
// Derivation and the gap-limit walk now live in ./walletScan; this module only
// supplies a BalanceResolver for environments that cannot open a raw TLS socket
// to an Electrum server (the Tauri desktop webview, and any browser context).
// It costs one HTTPS request per address, so it is markedly slower than the
// batched Electrum path in apps/web — prefer that one where sockets exist.
//
// Works server-side and client-side (pure JS, no Node.js-only APIs).

import { coreFetch } from './transport'
import { scanXpub, type BalanceResolver, type TargetStats, type XpubBalance } from './walletScan'

export const DEFAULT_MEMPOOL_BASE = 'https://mempool.space/api'

// Public Esplora hosts, tried in rotation. A wide gap scan is hundreds of
// requests, and a single public host will start throttling — eventually
// refusing connections outright rather than returning 429 — well before the
// scan finishes. Retrying the same host through that is futile; retrying a
// different one usually is not.
const PUBLIC_ESPLORA_BASES = [DEFAULT_MEMPOOL_BASE, 'https://blockstream.info/api']

let bases: string[] = PUBLIC_ESPLORA_BASES

// Point scans at a user-chosen Esplora/mempool instance (own node). Pass a
// falsy value to reset to the public rotation.
//
// A custom endpoint is used EXCLUSIVELY — we never silently fall back to a
// public host. Someone who configured their own node did so to keep their
// address queries off third-party servers, and quietly leaking them elsewhere
// on a transient failure would defeat exactly that.
export function setMempoolEndpoint(base?: string | null): void {
  bases = base ? [base.replace(/\/+$/, '')] : PUBLIC_ESPLORA_BASES
}

const ADDR_TIMEOUT_MS = 12_000

type MempoolAddrStats = {
  chain_stats: { funded_txo_sum: number; spent_txo_sum: number; tx_count: number }
  mempool_stats: { funded_txo_sum: number; spent_txo_sum: number; tx_count: number }
}

// Global in-flight cap. The scan fans out across (scriptType × chain) pairs, so
// a bare xpub can queue hundreds of addresses at once. mempool.space rate-limits
// (429) — and eventually refuses connections outright — under that burst, so cap
// the TOTAL simultaneous requests rather than letting every address fire at
// once. Prevents the 429 storm that used to silently drop funded addresses.
const MAX_CONCURRENT = 4
let inFlight = 0
const waiters: Array<() => void> = []
async function acquireSlot(): Promise<void> {
  if (inFlight < MAX_CONCURRENT) {
    inFlight++
    return
  }
  await new Promise<void>((resolve) => waiters.push(resolve))
  inFlight++
}
function releaseSlot(): void {
  inFlight--
  waiters.shift()?.()
}

// Retry budget for a single address lookup. Transient failures (429 rate-limit,
// 5xx, network/timeout) are retried with exponential backoff. Only a definitive
// failure after all retries throws — and it MUST throw, never resolve to a
// zero/empty result, or a rate-limited address would be miscounted as unused
// (dropping its balance and polluting the gap count).
const ADDR_MAX_RETRIES = 4
const ADDR_RETRY_BASE_MS = 500

function backoff(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(t)
      resolve()
    }, { once: true })
  })
}

// Fetch one address's stats. Distinguishes a genuinely-unused address (HTTP 200
// with zeroed stats — mempool.space never 404s an unused address) from a fetch
// FAILURE (429/5xx/network). Failures are retried, then thrown. A truthy result
// is always real chain data safe to trust.
async function fetchAddr(address: string, signal?: AbortSignal): Promise<MempoolAddrStats> {
  let lastErr: unknown
  for (let attempt = 0; attempt <= ADDR_MAX_RETRIES; attempt++) {
    await acquireSlot()
    const controller = new AbortController()
    const onAbort = () => controller.abort()
    signal?.addEventListener('abort', onAbort, { once: true })
    const timer = setTimeout(() => controller.abort(), ADDR_TIMEOUT_MS)
    // Rotate hosts across attempts, so a throttled primary yields to the next
    // one instead of burning the whole retry budget on a host that has already
    // decided to stop answering.
    const base = bases[attempt % bases.length]
    try {
      const res = await coreFetch(`${base}/address/${address}`, { signal: controller.signal })
      if (!res.ok) {
        const err = new Error(`esplora ${res.status} from ${base} for ${address}`) as Error & { status?: number }
        err.status = res.status
        throw err
      }
      return (await res.json()) as MempoolAddrStats
    } catch (e) {
      lastErr = e
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      releaseSlot()
    }
    // Give up immediately if the whole scan was aborted; otherwise back off and
    // retry — every failure here (429/5xx/network) is potentially transient.
    if (signal?.aborted || attempt === ADDR_MAX_RETRIES) break
    await backoff(ADDR_RETRY_BASE_MS * 2 ** attempt, signal)
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error(`Failed to fetch address ${address}`)
}

// One HTTPS request per address, bounded by MAX_CONCURRENT. Any address that
// cannot be reached rejects the whole scan (correctness over availability) —
// we never report a low balance because a lookup failed.
export const mempoolResolver: BalanceResolver = async (targets, signal) => {
  const stats = await Promise.all(targets.map((t) => fetchAddr(t.address, signal)))
  return stats.map((s): TargetStats => ({
    used: s.chain_stats.tx_count > 0 || s.mempool_stats.tx_count > 0,
    satsConfirmed: s.chain_stats.funded_txo_sum - s.chain_stats.spent_txo_sum,
    satsUnconfirmed: s.mempool_stats.funded_txo_sum - s.mempool_stats.spent_txo_sum,
    txCount: s.chain_stats.tx_count + s.mempool_stats.tx_count,
  }))
}

export async function fetchXpubBalanceDerived(
  xpub: string,
  signal?: AbortSignal,
  // Reports incremental addresses scanned as the gap walk progresses. Total is
  // unknown ahead of time (gap-limit scan is open-ended), so callers get a
  // running count — not a percentage — to drive a progress indicator.
  onProgress?: (addressesScanned: number) => void,
): Promise<XpubBalance> {
  return scanXpub(xpub, mempoolResolver, { signal, onProgress })
}
