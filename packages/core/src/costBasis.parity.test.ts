import { describe, expect, it } from 'vitest'

import { buildBuyPoints, computeCostBasis } from './costBasis'
import { CURRENCY_CODES } from './currencies'
import type { TxnRow } from './domain'
import fixtures from './__fixtures__/parity.fixtures.json'

// Cross-repo parity — the web half.
//
// costBasis.ts here and Compass-Mobile-App/src/lib/costBasis.ts are ports of
// one another, and the mobile header says the two "must agree to the cent".
// Nothing enforced that until this file: an identical copy of the fixture lives
// in both repos and each runs its own implementation against it. Whichever side
// drifts goes red in its own CI, naming the case that broke.
//
// The fixture is neutral about row shape on purpose. Mobile passes DB columns
// (amount_usd, btc_price_usd, txn_date); this side takes a compact TxnRow
// (u, priceUsd, iso, c). Each adapts. What is pinned is the semantics.
//
// Note `c: 'b'` below: isBuy() here also requires the bitcoin category, while
// mobile's isBuy only checks the amount because its caller pre-filters. Every
// fixture row is a bitcoin buy, so both sides see the same set.
//
// KNOWN DIVERGENCE, avoided rather than asserted: for an empty-string merchant
// this side returns null (`t.m || null`) and mobile returns '' (`?? null`). No
// fixture row uses one.

type FixtureRow = {
  id: string
  usd: number
  priceUsd: number | null
  date: string
  merchant: string
}

const toTxnRow = (r: FixtureRow): TxnRow => ({
  id: r.id,
  m: r.merchant,
  c: 'b',
  u: r.usd,
  i: 'bitcoin',
  d: r.date,
  note: null,
  source: 'manual',
  iso: r.date,
  txnAt: null,
  createdAt: null,
  priceUsd: r.priceUsd,
})

describe('parity fixture', () => {
  it('is the revision both repos expect', () => {
    // Bump in BOTH repos when the fixture changes. A mismatch means one side is
    // testing a stale copy, which would let real drift pass unnoticed.
    expect(fixtures._meta.version).toBe(1)
  })
})

describe('currency list agrees across repos and the DB constraint', () => {
  it('matches the fixture', () => {
    expect(CURRENCY_CODES).toEqual(fixtures.currencyCodes)
  })
})

describe.each(fixtures.cases)('costBasis parity: $name', (testCase) => {
  const rows = (testCase.rows as FixtureRow[]).map(toTxnRow)

  it('computeCostBasis matches the fixture', () => {
    expect(computeCostBasis(rows, testCase.livePriceUsd)).toEqual(testCase.expected.costBasis)
  })

  it('buildBuyPoints matches the fixture', () => {
    expect(buildBuyPoints(rows, testCase.livePriceUsd)).toEqual(testCase.expected.buyPoints)
  })
})
