import { describe, expect, it } from 'vitest'

import { buildProvider } from './memoryRepos'
import { emptyData, type CompassData } from './schema'

// Clearing has to survive the generator, which re-evaluates every condition on
// each app open. Without tombstones the feed refills itself and Clear all looks
// broken; these lock that in.
function makeProvider() {
  let data: CompassData = emptyData()
  return buildProvider({
    kind: 'local',
    load: async () => data,
    persist: (d) => {
      data = d
    },
  })
}

describe('notifications.clearAll', () => {
  it('empties the feed', async () => {
    const p = makeProvider()
    await p.notifications.add({ type: 'btc_move', title: 'up', dedupeKey: 'btcmove:up:2026-W33' })
    expect(await p.notifications.list()).toHaveLength(1)

    await p.notifications.clearAll()
    expect(await p.notifications.list()).toHaveLength(0)
  })

  it('keeps a still-true condition from coming back', async () => {
    const p = makeProvider()
    await p.notifications.add({ type: 'btc_move', title: 'up', dedupeKey: 'btcmove:up:2026-W33' })
    await p.notifications.clearAll()

    const wrote = await p.notifications.add({
      type: 'btc_move',
      title: 'up',
      dedupeKey: 'btcmove:up:2026-W33',
    })

    expect(wrote).toBe(false)
    expect(await p.notifications.list()).toHaveLength(0)
  })

  it('still lets a genuinely new event through', async () => {
    const p = makeProvider()
    await p.notifications.add({ type: 'btc_move', title: 'up', dedupeKey: 'btcmove:up:2026-W33' })
    await p.notifications.clearAll()

    // A later ISO week is a different key, so this is a new event, not a repeat.
    const wrote = await p.notifications.add({
      type: 'btc_move',
      title: 'up',
      dedupeKey: 'btcmove:up:2026-W34',
    })

    expect(wrote).toBe(true)
    expect(await p.notifications.list()).toHaveLength(1)
  })

  it('does not suppress rows that carry no dedupe key', async () => {
    const p = makeProvider()
    await p.notifications.add({ type: 'weekly_summary', title: 'week one' })
    await p.notifications.clearAll()

    const wrote = await p.notifications.add({ type: 'weekly_summary', title: 'week two' })

    expect(wrote).toBe(true)
    expect(await p.notifications.list()).toHaveLength(1)
  })
})
