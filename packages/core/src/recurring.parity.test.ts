import { describe, expect, it } from 'vitest'

import fixtures from './__fixtures__/recurring.fixtures.json'
import {
  MAX_CATCH_UP,
  cadenceLabel,
  dueDatesSince,
  monthlyEquivalent,
  nextOccurrence,
  occurrenceAfter,
  type Cadence,
} from './recurring'

// Cross-repo parity.
//
// Compass-Mobile-App's src/lib/recurring.ts is a port of this file. Unlike most
// ported maths, drift here is not cosmetic: these dates decide when a real
// transaction row is written, both apps write to the same table, and the
// (recurring_id, txn_date) unique index means the loser of a disagreement
// disappears without an error. The same fixture lives in both repos and each
// runs its own implementation against it, so whichever side drifts goes red in
// its own CI with the case name pointing at the behaviour.
//
// recurring.test.ts covers this implementation's own edges; this file covers
// only what both platforms must agree on.

describe('recurring parity fixture', () => {
  it('is the revision both repos expect', () => {
    // Bump in BOTH repos when the fixture changes. A mismatch here means one
    // side is testing against a stale copy, which would let real drift pass.
    expect(fixtures._meta.version).toBe(1)
  })
})

describe('nextOccurrence', () => {
  for (const c of fixtures.nextOccurrence) {
    it(c.name, () => {
      expect(nextOccurrence(c.anchor, c.cadence as Cadence, c.n)).toBe(c.expect)
    })
  }
})

describe('dueDatesSince', () => {
  for (const c of fixtures.dueDatesSince) {
    it(c.name, () => {
      const schedule = {
        cadence: c.cadence as Cadence,
        anchorDate: c.anchor,
        pausedAt: (c as { pausedAt?: string }).pausedAt ?? null,
      }
      expect(dueDatesSince(schedule, { fromIso: c.fromIso, today: c.today })).toEqual(c.expect)
    })
  }

  const cap = fixtures.catchUpCap
  it(cap.name, () => {
    const out = dueDatesSince(
      { cadence: cap.cadence as Cadence, anchorDate: cap.anchor },
      { fromIso: cap.fromIso, today: cap.today },
    )
    expect(out).toHaveLength(cap.expectLength)
    // The fixture pins the number; this pins it to the constant, so bumping
    // MAX_CATCH_UP without updating both repos' fixtures fails loudly.
    expect(MAX_CATCH_UP).toBe(cap.expectLength)
  })
})

describe('occurrenceAfter', () => {
  for (const c of fixtures.occurrenceAfter) {
    it(c.name, () => {
      expect(occurrenceAfter({ cadence: c.cadence as Cadence, anchorDate: c.anchor }, c.after)).toBe(
        c.expect,
      )
    })
  }
})

describe('monthlyEquivalent', () => {
  for (const c of fixtures.monthlyEquivalent) {
    it(c.name, () => {
      expect(monthlyEquivalent(c.amountUsd, c.cadence as Cadence)).toBeCloseTo(c.expect, 8)
    })
  }
})

describe('cadenceLabel', () => {
  for (const c of fixtures.cadenceLabel) {
    it(c.name, () => {
      expect(cadenceLabel(c.cadence as Cadence, c.anchor)).toBe(c.expect)
    })
  }
})
