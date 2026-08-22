import { describe, expect, it } from 'vitest'

import { compareTxnFeed, type TxnRow } from './domain'

// The feed comparator has to be a *total* order. Rows routinely tie on date,
// time and creation timestamp — a Plaid sync writes a whole batch under one
// created_at, and most banks report no clock time — and when the comparator
// returned 0 for those, the list fell back to whatever order the source handed
// us. Server-side that is physical row order, which an UPDATE changes, so
// recategorizing a purchase made it jump to the bottom of its day.

function row(over: Partial<TxnRow> & { id: string }): TxnRow {
  return {
    m: 'Coffee',
    c: 'd',
    u: 5,
    i: 'coffee',
    d: 'May 31',
    note: null,
    source: 'plaid',
    iso: '2026-05-31',
    txnAt: null,
    createdAt: '2026-05-31T12:00:00Z',
    priceUsd: null,
    ...over,
  }
}

describe('compareTxnFeed', () => {
  it('sorts newest day first', () => {
    const older = row({ id: 'a', iso: '2026-05-30' })
    const newer = row({ id: 'b', iso: '2026-05-31' })
    expect([older, newer].sort(compareTxnFeed)).toEqual([newer, older])
  })

  it('sorts timed rows above untimed ones on the same day', () => {
    const untimed = row({ id: 'a' })
    const timed = row({ id: 'b', txnAt: '2026-05-31T09:00:00Z' })
    expect([untimed, timed].sort(compareTxnFeed)).toEqual([timed, untimed])
  })

  it('sorts the later time first within a day', () => {
    const morning = row({ id: 'a', txnAt: '2026-05-31T09:00:00Z' })
    const evening = row({ id: 'b', txnAt: '2026-05-31T19:00:00Z' })
    expect([morning, evening].sort(compareTxnFeed)).toEqual([evening, morning])
  })

  it('breaks a created_at tie by id rather than declaring the rows equal', () => {
    const a = row({ id: '1111' })
    const b = row({ id: '2222' })
    expect(compareTxnFeed(a, b)).toBeGreaterThan(0)
    expect(compareTxnFeed(b, a)).toBeLessThan(0)
    expect(compareTxnFeed(a, a)).toBe(0)
  })

  it('keeps a fully tied row in place when its category or icon changes', () => {
    // The reported bug: same day, no time, same sync batch. Editing one row must
    // not move it, whichever order the caller happens to hand the rows over in.
    const batch = ['a1', 'b2', 'c3', 'd4'].map((id) => row({ id }))
    const before = [...batch].sort(compareTxnFeed).map((t) => t.id)

    const edited = batch.map((t) => (t.id === 'c3' ? { ...t, c: 'n' as const, i: 'grocery' } : t))
    // Reversed to stand in for the server handing back a different physical order
    // after the UPDATE rewrote the tuple.
    const after = edited.reverse().sort(compareTxnFeed).map((t) => t.id)

    expect(after).toEqual(before)
  })
})
