import { describe, expect, it } from 'vitest'

import {
  MAX_CATCH_UP,
  cadenceLabel,
  dueDatesSince,
  monthlyEquivalent,
  nextOccurrence,
  occurrenceAfter,
  yearlyEquivalent,
} from './recurring'

// The schedule math is the part of Recurring that fails silently: a wrong due
// date doesn't throw, it just quietly posts rent on the wrong day (or twice, or
// never). Month-end clamping is the specific trap — the naive implementation
// walks Jan 31 -> Feb 28 -> Mar 28 and the user's rent date drifts three days
// earlier forever.

describe('nextOccurrence', () => {
  it('returns the anchor itself at n = 0 and for negative n', () => {
    expect(nextOccurrence('2026-09-14', 'monthly', 0)).toBe('2026-09-14')
    expect(nextOccurrence('2026-09-14', 'monthly', -3)).toBe('2026-09-14')
  })

  it('walks days and weeks', () => {
    expect(nextOccurrence('2026-09-06', 'daily', 1)).toBe('2026-09-07')
    expect(nextOccurrence('2026-09-06', 'daily', 30)).toBe('2026-10-06')
    expect(nextOccurrence('2026-09-07', 'weekly', 1)).toBe('2026-09-14')
    expect(nextOccurrence('2026-09-07', 'weekly', 4)).toBe('2026-10-05')
  })

  it('keeps a weekly item on the same weekday across a DST boundary', () => {
    // US DST ends Nov 1 2026. Pure day-count math would be an hour off and
    // could land on a Sunday; date-only math cannot.
    const anchor = '2026-10-26' // a Monday
    for (let n = 0; n < 6; n++) {
      const iso = nextOccurrence(anchor, 'weekly', n)
      const [y, m, d] = iso.split('-').map(Number)
      expect(new Date(y, m - 1, d).getDay()).toBe(1)
    }
  })

  it('rolls monthly across a year boundary', () => {
    expect(nextOccurrence('2026-11-14', 'monthly', 1)).toBe('2026-12-14')
    expect(nextOccurrence('2026-11-14', 'monthly', 2)).toBe('2027-01-14')
    expect(nextOccurrence('2026-11-14', 'monthly', 14)).toBe('2028-01-14')
  })

  it('clamps a 31st anchor into short months without drifting', () => {
    expect(nextOccurrence('2026-01-31', 'monthly', 1)).toBe('2026-02-28')
    // The one that matters: March is back on the 31st, not stuck on the 28th.
    expect(nextOccurrence('2026-01-31', 'monthly', 2)).toBe('2026-03-31')
    expect(nextOccurrence('2026-01-31', 'monthly', 3)).toBe('2026-04-30')
    expect(nextOccurrence('2026-01-31', 'monthly', 4)).toBe('2026-05-31')
  })

  it('clamps to Feb 29 in a leap year', () => {
    expect(nextOccurrence('2028-01-31', 'monthly', 1)).toBe('2028-02-29')
    expect(nextOccurrence('2028-01-30', 'monthly', 1)).toBe('2028-02-29')
  })

  it('handles a Feb 29 yearly anchor in common years', () => {
    expect(nextOccurrence('2028-02-29', 'yearly', 1)).toBe('2029-02-28')
    expect(nextOccurrence('2028-02-29', 'yearly', 4)).toBe('2032-02-29')
  })

  it('walks yearly', () => {
    expect(nextOccurrence('2026-02-08', 'yearly', 1)).toBe('2027-02-08')
    expect(nextOccurrence('2026-02-08', 'yearly', 3)).toBe('2029-02-08')
  })
})

describe('dueDatesSince', () => {
  const monthly = { cadence: 'monthly' as const, anchorDate: '2026-01-14' }

  it('returns every occurrence from the cursor through today', () => {
    expect(
      dueDatesSince(monthly, { fromIso: '2026-01-14', today: '2026-04-20' }),
    ).toEqual(['2026-01-14', '2026-02-14', '2026-03-14', '2026-04-14'])
  })

  it('includes an occurrence that falls exactly on today', () => {
    expect(
      dueDatesSince(monthly, { fromIso: '2026-03-14', today: '2026-03-14' }),
    ).toEqual(['2026-03-14'])
  })

  it('logs a charge dated a few days before the item was entered', () => {
    // The regression this replaced: "Netflix, first charge the 4th" entered on
    // the 6th posted nothing at all, because the floor was the creation date.
    // The anchor is what the user typed as the first charge, so it counts.
    expect(
      dueDatesSince(
        { cadence: 'monthly', anchorDate: '2026-09-04' },
        { fromIso: '2026-09-04', today: '2026-09-06' },
      ),
    ).toEqual(['2026-09-04'])
  })

  it('honours a cursor later than the anchor', () => {
    expect(
      dueDatesSince(monthly, { fromIso: '2026-03-15', today: '2026-05-20' }),
    ).toEqual(['2026-04-14', '2026-05-14'])
  })

  it('returns nothing for a paused item', () => {
    expect(
      dueDatesSince(
        { ...monthly, pausedAt: '2026-02-01T00:00:00.000Z' },
        { fromIso: '2026-01-14', today: '2026-06-01' },
      ),
    ).toEqual([])
  })

  it('returns nothing when the next occurrence is still ahead', () => {
    expect(
      dueDatesSince(monthly, { fromIso: '2026-02-14', today: '2026-02-01' }),
    ).toEqual([])
  })

  it('caps a runaway catch-up', () => {
    // A daily item anchored years back must not post 900 rows in one pass.
    const out = dueDatesSince(
      { cadence: 'daily', anchorDate: '2020-01-01' },
      { fromIso: '2020-01-01', today: '2026-09-06' },
    )
    expect(out).toHaveLength(MAX_CATCH_UP)
  })
})

describe('occurrenceAfter', () => {
  it('finds the first date strictly later than the given one', () => {
    const monthly = { cadence: 'monthly' as const, anchorDate: '2026-01-31' }
    expect(occurrenceAfter(monthly, '2026-01-31')).toBe('2026-02-28')
    expect(occurrenceAfter(monthly, '2026-02-28')).toBe('2026-03-31')
  })

  it('returns the anchor when nothing has posted yet', () => {
    expect(
      occurrenceAfter({ cadence: 'weekly', anchorDate: '2026-09-07' }, '2026-09-01'),
    ).toBe('2026-09-07')
  })
})

describe('monthlyEquivalent', () => {
  it('leaves a monthly amount alone', () => {
    expect(monthlyEquivalent(22.99, 'monthly')).toBe(22.99)
  })

  it('spreads a yearly amount over twelve months', () => {
    expect(monthlyEquivalent(139, 'yearly')).toBeCloseTo(11.58, 2)
  })

  it('scales a weekly amount by the average weeks in a month', () => {
    expect(monthlyEquivalent(100, 'weekly')).toBeCloseTo(434.82, 2)
  })

  it('round-trips through the yearly figure', () => {
    expect(yearlyEquivalent(22.99, 'monthly')).toBeCloseTo(275.88, 2)
    expect(yearlyEquivalent(139, 'yearly')).toBeCloseTo(139, 6)
  })
})

describe('cadenceLabel', () => {
  it('names the weekday for weekly items', () => {
    expect(cadenceLabel('weekly', '2026-09-07')).toBe('Weekly · Mondays')
  })

  it('uses an ordinal day for monthly items', () => {
    expect(cadenceLabel('monthly', '2026-09-01')).toBe('Monthly · 1st')
    expect(cadenceLabel('monthly', '2026-09-02')).toBe('Monthly · 2nd')
    expect(cadenceLabel('monthly', '2026-09-03')).toBe('Monthly · 3rd')
    expect(cadenceLabel('monthly', '2026-09-11')).toBe('Monthly · 11th')
    expect(cadenceLabel('monthly', '2026-09-22')).toBe('Monthly · 22nd')
  })

  it('warns that a late-month anchor will not always land on that day', () => {
    expect(cadenceLabel('monthly', '2026-01-31')).toBe('Monthly · 31st (or month end)')
  })

  it('names the date for yearly items', () => {
    expect(cadenceLabel('yearly', '2026-02-08')).toBe('Yearly · Feb 8')
  })
})
