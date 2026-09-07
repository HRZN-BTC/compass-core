// Shared domain row shapes. Single source of truth — the web data layer
// (apps/web/lib/data/*) and any storage provider import these rather than
// redeclaring them.

export type TxnRow = {
  id: string
  m: string // merchant
  c: 'b' | 'n' | 'd' | 'f' | 'i' // category code (b = bitcoin, i = income)
  u: number // amount usd
  i: string // icon key
  d: string // short date label, e.g. "May 31"
  note: string | null
  source: string
  iso: string // raw txn_date
  txnAt: string | null // when the purchase happened, when the bank reports it; null for manual entries and banks that don't
  createdAt: string | null // row insertion timestamp; breaks same-day ties once txnAt has (newest added first)
  priceUsd: number | null // frozen BTC/USD price on txn_date; null = uncached (UI falls back to live)
  plaidAccountId?: string | null // which connected bank account this came from; null on manual rows
  recurringId?: string | null // set when a recurring item posted this row; drives the ↻ badge
}

// Clock time for a transaction, for display beside its date. Null when the row
// has no time — manual entries never do, and plenty of banks don't report one —
// so callers render the date alone rather than inventing a midnight.
export function fmtTxnTime(txnAt: string | null | undefined): string | null {
  if (!txnAt) return null
  const d = new Date(txnAt)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

// Newest first: the day, then the time within that day when the source reports
// one, then the order rows were added.
//
// Untimed rows sort BELOW timed rows on the same day, matching the server's
// `txn_at desc nulls last`. Postgres sorts nulls first by default under `desc`,
// which would bury every timed purchase under the manual entries — so both the
// query and this comparator have to say it explicitly, and they have to agree,
// or a client-sorted list and a server-sorted one disagree about the same data.
export function compareTxnFeed(a: TxnRow, b: TxnRow): number {
  if (a.iso !== b.iso) return a.iso < b.iso ? 1 : -1
  if (a.txnAt !== b.txnAt) {
    if (!a.txnAt) return 1
    if (!b.txnAt) return -1
    return a.txnAt < b.txnAt ? 1 : -1
  }
  if (a.createdAt !== b.createdAt) return (b.createdAt ?? '').localeCompare(a.createdAt ?? '')
  // Id last, so the order is total. Rows can tie on all three keys above — a
  // Plaid sync writes a whole batch under one created_at, and most banks send no
  // time at all — and without a final key the list falls back to whatever order
  // the source handed us. On the server that's physical row order, which an
  // UPDATE changes, so recategorizing a purchase made it jump down the day.
  // Mirrors the query's trailing `order('id', desc)`; the two have to agree.
  return b.id.localeCompare(a.id)
}

export type AccountRow = {
  id: string
  name: string
  type: string // Cash | Savings | Investments | Retirement | Property | Other
  balanceUsd: number
  isLiability: boolean
  sortOrder: number
  plaidAccountId?: string | null // set = synced from a connected bank, read-only in clients
}
