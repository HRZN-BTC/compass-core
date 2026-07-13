// Client-side monthly reflection generator — replaces the server batch job.
// Runs on app open: for every month that has transactions, compute the
// reflection aggregates and upsert. Past months are 'complete'; the current
// month is 'building' and refreshed on every run so it tracks live spending.

import type { StorageProvider } from '../storage/provider'
import type { StoredTxn } from '../storage/schema'

const SATS_PER_BTC = 1e8

type MonthAgg = {
  necessary: number
  discretionary: number
  wasteful: number
  spendSats: number
  stackedBtc: number
}

function aggregate(txns: StoredTxn[], fallbackPriceUsd: number): MonthAgg {
  const agg: MonthAgg = { necessary: 0, discretionary: 0, wasteful: 0, spendSats: 0, stackedBtc: 0 }
  for (const t of txns) {
    const price = t.btcPriceUsd && t.btcPriceUsd > 0 ? t.btcPriceUsd : fallbackPriceUsd
    switch (t.category) {
      case 'necessary':
      case 'discretionary':
      case 'wasteful':
        agg[t.category] += t.amountUsd
        if (price > 0) agg.spendSats += Math.round((t.amountUsd / price) * SATS_PER_BTC)
        break
      case 'bitcoin':
        // Stacking: USD spent on bitcoin converted at the txn's frozen price.
        if (price > 0) agg.stackedBtc += t.amountUsd / price
        break
      case 'income':
        break
    }
  }
  return agg
}

export async function generateReflections(provider: StorageProvider, livePriceUsd: number): Promise<void> {
  const [txns, existing] = await Promise.all([provider.transactions.list(), provider.reflections.list()])
  if (txns.length === 0) return

  const byMonth = new Map<string, StoredTxn[]>()
  for (const t of txns) {
    if (!t.date) continue
    const key = t.date.slice(0, 7)
    if (!byMonth.has(key)) byMonth.set(key, [])
    byMonth.get(key)!.push(t)
  }

  const nowKey = new Date().toISOString().slice(0, 7)
  const keys = [...byMonth.keys()].sort()
  const existingByKey = new Map(existing.map((r) => [`${r.year}-${String(r.month).padStart(2, '0')}`, r]))

  let prevStacked: number | null = null
  for (const key of keys) {
    if (key > nowKey) continue // ignore future-dated entries
    const status = key === nowKey ? 'building' : 'complete'
    const agg = aggregate(byMonth.get(key)!, livePriceUsd)
    const prior = existingByKey.get(key)

    // Skip untouched complete months (idempotent across launches); always
    // refresh the building month.
    const changed =
      !prior ||
      status === 'building' ||
      prior.status !== 'complete' ||
      prior.totalSpendSats !== agg.spendSats ||
      prior.accumBtc !== agg.stackedBtc

    if (changed) {
      await provider.reflections.upsertMonth({
        year: Number(key.slice(0, 4)),
        month: Number(key.slice(5, 7)),
        status,
        spendNecessaryUsd: agg.necessary,
        spendDiscretionaryUsd: agg.discretionary,
        spendWastefulUsd: agg.wasteful,
        totalSpendSats: agg.spendSats,
        accumBtc: agg.stackedBtc,
        prevAccumBtc: prevStacked,
        goalImpactDays: null,
      })
    }
    prevStacked = agg.stackedBtc
  }
}
