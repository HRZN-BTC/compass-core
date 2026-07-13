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
  createdAt: string | null // row insertion timestamp; ties-breaks same-day order (newest added first)
  priceUsd: number | null // frozen BTC/USD price on txn_date; null = uncached (UI falls back to live)
}

export type AccountRow = {
  id: string
  name: string
  type: string // Cash | Savings | Investments | Retirement | Property | Other
  balanceUsd: number
  isLiability: boolean
  sortOrder: number
}
