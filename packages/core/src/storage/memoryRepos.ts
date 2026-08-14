// Repo implementations over an in-memory CompassData object. Both current
// backends (encrypted JSON file on Tauri, localStorage in browser dev) hold the
// whole dataset in memory and differ only in load/persist — so the domain logic
// lives here exactly once. A future SQLite provider replaces this wholesale.

import { uuidv7 } from '../id'
import { emptyData, migrateExport, toExport, type CompassData, type StoredPlaidItem, type StoredTxn } from './schema'
import type {
  ImportMode,
  ImportReport,
  NewPlaidAccount,
  NewPlaidItem,
  NewPlaidTxn,
  NewStoredAccount,
  NewStoredGoal,
  NewStoredNotification,
  NewStoredTxn,
  StorageProvider,
} from './provider'

type Persist = () => void

function nowIso(): string {
  return new Date().toISOString()
}

// Merge two row arrays by id, newest updatedAt wins (LWW — the same rule the
// future sync merge uses).
function mergeRows<T extends { id: string; updatedAt: string }>(mine: T[], theirs: T[]): T[] {
  const byId = new Map(mine.map((r) => [r.id, r]))
  for (const r of theirs) {
    const cur = byId.get(r.id)
    if (!cur || r.updatedAt > cur.updatedAt) byId.set(r.id, r)
  }
  return [...byId.values()]
}

export function buildProvider(opts: {
  kind: StorageProvider['kind']
  load: () => Promise<CompassData | null>
  persist: (data: CompassData) => void
  eraseBacking?: () => Promise<void>
}): StorageProvider {
  let data: CompassData = emptyData()
  const listeners = new Set<() => void>()

  const notify = () => {
    for (const fn of listeners) fn()
  }
  const save: Persist = () => {
    opts.persist(data)
    notify()
  }

  return {
    kind: opts.kind,

    async init() {
      const loaded = await opts.load()
      if (loaded) data = loaded
      notify()
    },

    transactions: {
      async list() {
        return [...data.transactions]
      },
      async create(input: NewStoredTxn) {
        const t: StoredTxn = {
          id: uuidv7(),
          date: input.date,
          merchant: input.merchant,
          amountUsd: input.amountUsd,
          category: input.category,
          icon: input.icon ?? 'cart',
          note: input.note ?? null,
          source: input.source ?? 'manual',
          btcPriceUsd: input.btcPriceUsd ?? null,
          createdAt: nowIso(),
          updatedAt: nowIso(),
        }
        data.transactions.push(t)
        save()
        return t
      },
      async update(id, patch) {
        const t = data.transactions.find((x) => x.id === id)
        if (!t) throw new Error('transaction not found')
        Object.assign(t, patch, { updatedAt: nowIso() })
        save()
      },
      async remove(id) {
        data.transactions = data.transactions.filter((t) => t.id !== id)
        save()
      },
      async bulkUpsert(rows) {
        data.transactions = mergeRows(data.transactions, rows)
        save()
        return rows.length
      },
      async upsertPlaid(rows: NewPlaidTxn[]) {
        const seen = new Set(
          data.transactions.map((t) => t.plaidTransactionId).filter((x): x is string => !!x),
        )
        let added = 0
        for (const r of rows) {
          if (seen.has(r.plaidTransactionId)) continue // insert-if-absent: never clobber a recategorized row
          data.transactions.push({
            id: uuidv7(),
            date: r.date,
            at: r.at ?? null,
            merchant: r.merchant,
            amountUsd: r.amountUsd,
            category: r.category,
            icon: r.icon,
            note: null,
            source: 'plaid',
            plaidTransactionId: r.plaidTransactionId,
            plaidAccountId: r.plaidAccountId,
            btcPriceUsd: r.btcPriceUsd ?? null,
            createdAt: nowIso(),
            updatedAt: nowIso(),
          })
          seen.add(r.plaidTransactionId)
          added++
        }
        if (added) save()
        return added
      },
      async updatePlaid(plaidTransactionId, patch) {
        const t = data.transactions.find((x) => x.plaidTransactionId === plaidTransactionId)
        if (!t) return
        if (patch.date !== undefined) t.date = patch.date
        if (patch.at !== undefined) t.at = patch.at
        if (patch.merchant !== undefined) t.merchant = patch.merchant
        if (patch.amountUsd !== undefined) t.amountUsd = patch.amountUsd
        if (patch.btcPriceUsd !== undefined) t.btcPriceUsd = patch.btcPriceUsd
        t.updatedAt = nowIso()
        save()
      },
      async removeByPlaidTxnIds(ids) {
        const set = new Set(ids)
        const before = data.transactions.length
        data.transactions = data.transactions.filter(
          (t) => !(t.plaidTransactionId && set.has(t.plaidTransactionId)),
        )
        const removed = before - data.transactions.length
        if (removed) save()
        return removed
      },
    },

    goals: {
      async list() {
        return [...data.goals]
      },
      async create(input: NewStoredGoal) {
        const isPrimary = input.isPrimary ?? data.goals.length === 0
        if (isPrimary) for (const g of data.goals) g.isPrimary = false
        const g = {
          id: uuidv7(),
          name: input.name,
          unit: input.unit,
          type: input.type ?? 'custom',
          target: input.target,
          saved: input.saved ?? 0,
          monthly: input.monthly ?? 0,
          isPrimary,
          createdAt: nowIso(),
          updatedAt: nowIso(),
        }
        data.goals.push(g)
        save()
        return g
      },
      async update(id, patch) {
        const g = data.goals.find((x) => x.id === id)
        if (!g) throw new Error('goal not found')
        Object.assign(g, patch, { updatedAt: nowIso() })
        save()
      },
      async setPrimary(id) {
        for (const g of data.goals) {
          const should = g.id === id
          if (g.isPrimary !== should) {
            g.isPrimary = should
            g.updatedAt = nowIso()
          }
        }
        save()
      },
      async remove(id) {
        data.goals = data.goals.filter((g) => g.id !== id)
        if (!data.goals.some((g) => g.isPrimary) && data.goals[0]) {
          data.goals[0].isPrimary = true
          data.goals[0].updatedAt = nowIso()
        }
        save()
      },
    },

    accounts: {
      async list() {
        return [...data.accounts].sort((a, b) => a.sortOrder - b.sortOrder)
      },
      async create(input: NewStoredAccount) {
        const a = {
          id: uuidv7(),
          name: input.name,
          type: input.type,
          balanceUsd: input.balanceUsd,
          isLiability: input.isLiability,
          sortOrder: input.sortOrder ?? data.accounts.length,
          createdAt: nowIso(),
          updatedAt: nowIso(),
        }
        data.accounts.push(a)
        save()
        return a
      },
      async update(id, patch) {
        const a = data.accounts.find((x) => x.id === id)
        if (!a) throw new Error('account not found')
        Object.assign(a, patch, { updatedAt: nowIso() })
        save()
      },
      async remove(id) {
        data.accounts = data.accounts.filter((a) => a.id !== id)
        save()
      },
      async upsertByPlaidAccountId(rows: NewPlaidAccount[]) {
        for (const r of rows) {
          const ex = data.accounts.find((a) => a.plaidAccountId === r.plaidAccountId)
          if (ex) {
            ex.name = r.name
            ex.type = r.type
            ex.balanceUsd = r.balanceUsd
            ex.isLiability = r.isLiability
            ex.updatedAt = nowIso()
          } else {
            data.accounts.push({
              id: uuidv7(),
              name: r.name,
              type: r.type,
              balanceUsd: r.balanceUsd,
              isLiability: r.isLiability,
              sortOrder: data.accounts.length,
              plaidAccountId: r.plaidAccountId,
              createdAt: nowIso(),
              updatedAt: nowIso(),
            })
          }
        }
        save()
      },
      async removeByPlaidAccountIds(ids) {
        const set = new Set(ids)
        const before = data.accounts.length
        data.accounts = data.accounts.filter((a) => !(a.plaidAccountId && set.has(a.plaidAccountId)))
        const removed = before - data.accounts.length
        if (removed) save()
        return removed
      },
    },

    wallet: {
      async get() {
        return { ...data.wallet }
      },
      async saveXpub(xpub, balanceBtc) {
        data.wallet = { mode: 'xpub', xpub, balanceBtc, lastScanAt: nowIso(), updatedAt: nowIso() }
        save()
      },
      async setManualBalance(balanceBtc) {
        data.wallet = { mode: 'manual', xpub: null, balanceBtc, lastScanAt: null, updatedAt: nowIso() }
        save()
      },
      async setBalance(balanceBtc) {
        data.wallet.balanceBtc = balanceBtc
        data.wallet.lastScanAt = nowIso()
        data.wallet.updatedAt = nowIso()
        save()
      },
      async addSnapshot(s) {
        data.snapshots.push({ id: uuidv7(), ...s })
        save()
      },
      async listSnapshots() {
        return [...data.snapshots]
      },
      async clear() {
        data.wallet = { mode: null, xpub: null, balanceBtc: 0, lastScanAt: null, updatedAt: nowIso() }
        save()
      },
    },

    plaidItems: {
      async list() {
        return [...data.plaidItems]
      },
      async upsert(input: NewPlaidItem) {
        const ex = data.plaidItems.find((i) => i.itemId === input.itemId)
        if (ex) {
          if (input.institutionId !== undefined) ex.institutionId = input.institutionId ?? null
          if (input.institutionName !== undefined) ex.institutionName = input.institutionName ?? null
          if (input.status !== undefined) ex.status = input.status
          if (input.lastSyncedAt !== undefined) ex.lastSyncedAt = input.lastSyncedAt ?? null
          ex.updatedAt = nowIso()
          save()
          return { ...ex }
        }
        const item: StoredPlaidItem = {
          id: uuidv7(),
          itemId: input.itemId,
          institutionId: input.institutionId ?? null,
          institutionName: input.institutionName ?? null,
          status: input.status ?? 'active',
          lastSyncedAt: input.lastSyncedAt ?? null,
          createdAt: nowIso(),
          updatedAt: nowIso(),
        }
        data.plaidItems.push(item)
        save()
        return { ...item }
      },
      async remove(itemId) {
        data.plaidItems = data.plaidItems.filter((i) => i.itemId !== itemId)
        save()
      },
    },

    notifications: {
      async list() {
        return [...data.notifications].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      },
      async add(input: NewStoredNotification) {
        if (input.dedupeKey && data.notifications.some((n) => n.dedupeKey === input.dedupeKey)) {
          return false
        }
        data.notifications.push({
          id: uuidv7(),
          type: input.type,
          title: input.title,
          subtitle: input.subtitle ?? null,
          icon: input.icon ?? 'list',
          deepLink: input.deepLink ?? null,
          read: false,
          dedupeKey: input.dedupeKey ?? null,
          createdAt: nowIso(),
        })
        save()
        return true
      },
      async markRead(id) {
        const n = data.notifications.find((x) => x.id === id)
        if (!n || n.read) return
        n.read = true
        save()
      },
      async markAllRead() {
        let changed = false
        for (const n of data.notifications) {
          if (!n.read) {
            n.read = true
            changed = true
          }
        }
        if (changed) save()
      },
      async prune(keep) {
        if (data.notifications.length <= keep) return
        data.notifications = [...data.notifications]
          .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
          .slice(0, keep)
        save()
      },
    },

    settings: {
      async get() {
        return { ...data.settings }
      },
      async patch(p) {
        Object.assign(data.settings, p, { updatedAt: nowIso() })
        save()
      },
    },

    async exportAll() {
      return toExport(data)
    },

    async importAll(raw, mode: ImportMode): Promise<ImportReport> {
      const incoming = migrateExport(raw)
      if (mode === 'replace') {
        data = incoming
      } else {
        data.transactions = mergeRows(data.transactions, incoming.transactions)
        data.goals = mergeRows(data.goals, incoming.goals)
        data.accounts = mergeRows(data.accounts, incoming.accounts)
        data.plaidItems = mergeRows(data.plaidItems, incoming.plaidItems)
        // Notifications carry no updatedAt, so mergeRows doesn't apply — union
        // on id and drop anything that duplicates a dedupeKey already held.
        {
          const ids = new Set(data.notifications.map((n) => n.id))
          const keys = new Set(data.notifications.map((n) => n.dedupeKey).filter(Boolean))
          for (const n of incoming.notifications ?? []) {
            if (ids.has(n.id)) continue
            if (n.dedupeKey && keys.has(n.dedupeKey)) continue
            data.notifications.push(n)
          }
        }
        if (incoming.wallet.updatedAt > data.wallet.updatedAt) data.wallet = incoming.wallet
        if (incoming.settings.updatedAt > data.settings.updatedAt) data.settings = incoming.settings
        const seen = new Set(data.snapshots.map((s) => s.id))
        for (const s of incoming.snapshots) if (!seen.has(s.id)) data.snapshots.push(s)
      }
      save()
      return {
        transactions: incoming.transactions.length,
        goals: incoming.goals.length,
        accounts: incoming.accounts.length,
      }
    },

    async wipe() {
      data = emptyData()
      await opts.eraseBacking?.()
      save()
    },

    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
  }
}
