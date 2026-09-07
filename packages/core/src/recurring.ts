// Recurring schedule math. Shared by web (Supabase-backed) and desktop
// (local-store-backed) so both platforms agree on exactly which dates a
// commitment is due — the one piece of this feature that must not diverge.
//
// Everything here is date-only string math (YYYY-MM-DD). No Date arithmetic
// across timezones, no UTC drift: "the 1st" means the 1st wherever the user is.

export type Cadence = 'daily' | 'weekly' | 'monthly' | 'yearly'

export const CADENCES: ReadonlyArray<{ id: Cadence; label: string }> = [
  { id: 'daily', label: 'Daily' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'monthly', label: 'Monthly' },
  { id: 'yearly', label: 'Yearly' },
]

// The shape the schedule functions need. Both the Supabase row and the local
// StoredRecurring structurally satisfy this.
export type RecurringSchedule = {
  cadence: Cadence
  anchorDate: string // YYYY-MM-DD — the first occurrence
  pausedAt?: string | null
}

function parts(iso: string): [number, number, number] {
  const [y, m, d] = iso.split('-').map(Number)
  return [y, m, d]
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

export function toIso(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`
}

export function daysInMonth(year: number, month1: number): number {
  // Day 0 of the next month is the last day of this one.
  return new Date(year, month1, 0).getDate()
}

// Add whole calendar days to a date-only string.
//
// Deliberately NOT `+ n * 86400000`: adding elapsed milliseconds across a DST
// boundary lands on 23:00 the previous day, which silently walks a weekly item
// onto the wrong weekday and keeps it there. Handing an out-of-range day to the
// Date constructor lets the calendar normalise it — Oct 26 + 7 is Nov 2, still
// a Monday, whatever the clocks did in between.
function addDays(iso: string, n: number): string {
  const [y, m, d] = parts(iso)
  const dt = new Date(y, m - 1, d + n)
  return toIso(dt.getFullYear(), dt.getMonth() + 1, dt.getDate())
}

export function todayIso(now: Date = new Date()): string {
  return toIso(now.getFullYear(), now.getMonth() + 1, now.getDate())
}

/**
 * The nth occurrence of a schedule, counting the anchor itself as n = 0.
 *
 * Monthly and yearly clamp to the end of a short month rather than spilling
 * into the next one: an item anchored on Jan 31 lands on Feb 28 (or 29), then
 * returns to Mar 31. Computing from the anchor each time — rather than
 * repeatedly advancing the previous result — is what stops that clamp from
 * becoming permanent drift down to the 28th.
 */
export function nextOccurrence(anchorDate: string, cadence: Cadence, n: number): string {
  const [y, m, d] = parts(anchorDate)
  if (n <= 0) return toIso(y, m, d)

  if (cadence === 'daily') return addDays(anchorDate, n)
  if (cadence === 'weekly') return addDays(anchorDate, n * 7)

  const monthsOn = cadence === 'yearly' ? n * 12 : n
  const abs = (m - 1) + monthsOn
  const year = y + Math.floor(abs / 12)
  const month = (abs % 12) + 1
  return toIso(year, month, Math.min(d, daysInMonth(year, month)))
}

// A catch-up walks forward one occurrence at a time. This caps how far it will
// walk in a single pass so a mis-entered anchor (or a store restored from a
// years-old backup) can't post hundreds of rows before anyone notices.
export const MAX_CATCH_UP = 60

/**
 * Every due date from `fromIso` (inclusive) through today (inclusive).
 *
 * The anchor is the floor, and deliberately so: the field the user fills in is
 * labelled "first charge", so an anchor of the 4th when today is the 6th means
 * "that charge already went out" and must be logged. An earlier version floored
 * this at the item's creation date instead, which silently dropped exactly that
 * case — you entered a bill dated two days ago and nothing appeared.
 *
 * A back-dated anchor therefore posts its whole history, capped at
 * MAX_CATCH_UP. The modal shows the resulting count before saving, so the
 * number of rows is never a surprise.
 *
 * Returns [] for a paused item.
 */
export function dueDatesSince(
  schedule: RecurringSchedule,
  opts: { fromIso: string; today?: string },
): string[] {
  if (schedule.pausedAt) return []
  const today = opts.today ?? todayIso()

  const out: string[] = []
  for (let n = 0; n < MAX_CATCH_UP * 8; n++) {
    const iso = nextOccurrence(schedule.anchorDate, schedule.cadence, n)
    if (iso > today) break
    if (iso >= opts.fromIso) {
      out.push(iso)
      if (out.length >= MAX_CATCH_UP) break
    }
  }
  return out
}

/**
 * The first occurrence strictly after `afterIso`. This is what the poster
 * writes back to `next_due` once it has posted everything owed.
 */
export function occurrenceAfter(schedule: RecurringSchedule, afterIso: string): string {
  for (let n = 0; n < MAX_CATCH_UP * 8; n++) {
    const iso = nextOccurrence(schedule.anchorDate, schedule.cadence, n)
    if (iso > afterIso) return iso
  }
  // Unreachable for real anchors; keep the return total rather than throwing
  // inside a render path.
  return nextOccurrence(schedule.anchorDate, schedule.cadence, MAX_CATCH_UP * 8)
}

// Average occurrences per month, used to put every cadence on one comparable
// "costs you $X a month" figure. 365.25/12 keeps leap years honest.
const PER_MONTH: Record<Cadence, number> = {
  daily: 365.25 / 12,
  weekly: 365.25 / 12 / 7,
  monthly: 1,
  yearly: 1 / 12,
}

export function monthlyEquivalent(amountUsd: number, cadence: Cadence): number {
  return amountUsd * PER_MONTH[cadence]
}

export function yearlyEquivalent(amountUsd: number, cadence: Cadence): number {
  return monthlyEquivalent(amountUsd, cadence) * 12
}

// "Monthly · 14th" / "Weekly · Mondays" / "Yearly · Feb 8" — the sub-line under
// a merchant in the recurring panel.
const WEEKDAYS = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function ordinal(n: number): string {
  const rem100 = n % 100
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`
  const rem10 = n % 10
  return `${n}${rem10 === 1 ? 'st' : rem10 === 2 ? 'nd' : rem10 === 3 ? 'rd' : 'th'}`
}

export function cadenceLabel(cadence: Cadence, anchorDate: string): string {
  const [y, m, d] = parts(anchorDate)
  if (cadence === 'daily') return 'Daily'
  if (cadence === 'weekly') return `Weekly · ${WEEKDAYS[new Date(y, m - 1, d).getDay()]}`
  if (cadence === 'yearly') return `Yearly · ${MONTHS[m - 1]} ${d}`
  // A monthly item anchored past the 28th won't hit that day every month.
  return d > 28 ? `Monthly · ${ordinal(d)} (or month end)` : `Monthly · ${ordinal(d)}`
}
