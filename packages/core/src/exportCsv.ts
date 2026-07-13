import type { TxnRow, AccountRow } from './domain'

// Client-side CSV export. No dependencies — builds a CSV string and triggers a
// browser download via a Blob. Two shapes: the spending log (transactions) and
// the net-worth sheet (manual accounts + the read-only Bitcoin wallet line).
// Transactions use their frozen per-row BTC price; net worth uses the live price
// (manual account balances carry no price stamp).

const SATS_PER_BTC = 100_000_000

const CAT_LABEL: Record<string, string> = {
  b: 'Bitcoin',
  n: 'Necessary',
  d: 'Discretionary',
  f: 'Wasteful',
  i: 'Income',
}

type Cell = string | number

// Escapes a single field per RFC 4180: wrap in quotes if it contains a comma,
// quote, or newline; double any interior quotes.
function escapeCell(value: Cell): string {
  const s = String(value ?? '')
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(headers: string[], rows: Cell[][]): string {
  const lines = [headers, ...rows].map((r) => r.map(escapeCell).join(','))
  return lines.join('\r\n')
}

// Triggers a browser download of `text` as `filename`. No-op outside the browser.
export function downloadCsv(filename: string, text: string): void {
  if (typeof document === 'undefined') return
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function toBtc(usd: number, price: number): number {
  return price > 0 ? usd / price : 0
}

export function buildTransactionsCsv(txns: TxnRow[], livePrice: number): string {
  const headers = ['Date', 'Merchant', 'Category', 'Amount USD', 'BTC Price USD', 'BTC', 'Sats', 'Note', 'Source']
  const rows: Cell[][] = txns.map((t) => {
    const price = t.priceUsd != null && t.priceUsd > 0 ? t.priceUsd : livePrice
    const btc = toBtc(t.u, price)
    return [
      t.iso,
      t.m,
      CAT_LABEL[t.c] ?? t.c,
      t.u.toFixed(2),
      price > 0 ? price.toFixed(2) : '',
      btc.toFixed(8),
      Math.round(btc * SATS_PER_BTC),
      t.note ?? '',
      t.source ?? '',
    ]
  })
  return toCsv(headers, rows)
}

export function buildNetWorthCsv(accounts: AccountRow[], holdingsBtc: number, livePrice: number): string {
  const headers = ['Account', 'Type', 'Kind', 'Balance USD', 'BTC', 'Sats']
  const rows: Cell[][] = []

  // Read-only Bitcoin wallet line first — priced live so net worth is complete.
  const walletUsd = holdingsBtc * livePrice
  rows.push(['Bitcoin wallet', 'Bitcoin', 'Asset', walletUsd.toFixed(2), holdingsBtc.toFixed(8), Math.round(holdingsBtc * SATS_PER_BTC)])

  for (const a of accounts) {
    const btc = toBtc(a.balanceUsd, livePrice)
    rows.push([
      a.name,
      a.type,
      a.isLiability ? 'Liability' : 'Asset',
      a.balanceUsd.toFixed(2),
      btc.toFixed(8),
      Math.round(btc * SATS_PER_BTC),
    ])
  }

  // Net worth = wallet + assets - liabilities.
  const assets = accounts.filter((a) => !a.isLiability).reduce((s, a) => s + a.balanceUsd, 0)
  const liabilities = accounts.filter((a) => a.isLiability).reduce((s, a) => s + a.balanceUsd, 0)
  const totalUsd = walletUsd + assets - liabilities
  const totalBtc = toBtc(totalUsd, livePrice)
  rows.push(['Net worth (total)', '', '', totalUsd.toFixed(2), totalBtc.toFixed(8), Math.round(totalBtc * SATS_PER_BTC)])

  return toCsv(headers, rows)
}
