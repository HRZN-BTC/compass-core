// StorageProvider — the seam between UI data hooks and persistence. One
// provider per platform (encrypted JSON file on desktop, localStorage in
// browser dev, IndexedDB later on web, SQLite later on mobile); only the
// implementation changes, never the interface. Repos expose named methods for
// exactly the queries the app makes — no generic query builder, so every
// backend can implement them honestly.

import type {
  CompassData,
  CompassExport,
  StoredAccount,
  StoredGoal,
  StoredPlaidItem,
  StoredSnapshot,
  StoredTxn,
  StoredWallet,
  StoredSettings,
  TxnCategory,
} from './schema'

export type NewStoredTxn = {
  date: string
  merchant: string
  amountUsd: number
  category: TxnCategory
  icon?: string
  note?: string | null
  source?: string
  btcPriceUsd?: number | null
}

// A bank-synced transaction to ingest. source is forced to 'plaid'; the
// plaidTransactionId is the idempotency key.
export type NewPlaidTxn = {
  plaidTransactionId: string
  plaidAccountId: string
  date: string
  merchant: string
  amountUsd: number
  category: TxnCategory
  icon: string
  at?: string | null // purchase time, when the bank reports one
  btcPriceUsd?: number | null
}

// A bank account mirrored onto the net-worth ledger, keyed by plaidAccountId.
export type NewPlaidAccount = {
  plaidAccountId: string
  name: string
  type: string
  balanceUsd: number
  isLiability: boolean
}

export interface TransactionRepo {
  list(): Promise<StoredTxn[]>
  create(input: NewStoredTxn): Promise<StoredTxn>
  update(id: string, patch: Partial<Omit<StoredTxn, 'id' | 'createdAt' | 'updatedAt'>>): Promise<void>
  remove(id: string): Promise<void>
  bulkUpsert(rows: StoredTxn[]): Promise<number>
  // Plaid ingest: insert-if-absent keyed on plaidTransactionId so a re-sync
  // never overwrites a row the user has recategorized. Returns rows added.
  upsertPlaid(rows: NewPlaidTxn[]): Promise<number>
  // Bank-owned fields only (date/time/merchant/amount) for a modified Plaid row.
  updatePlaid(plaidTransactionId: string, patch: { date?: string; at?: string | null; merchant?: string; amountUsd?: number; btcPriceUsd?: number | null }): Promise<void>
  removeByPlaidTxnIds(plaidTransactionIds: string[]): Promise<number>
}

export type NewStoredGoal = {
  name: string
  unit: 'btc' | 'usd'
  type?: string
  target: number
  saved?: number
  monthly?: number
  isPrimary?: boolean
}

export interface GoalRepo {
  list(): Promise<StoredGoal[]>
  create(input: NewStoredGoal): Promise<StoredGoal>
  update(id: string, patch: Partial<Omit<StoredGoal, 'id' | 'createdAt' | 'updatedAt'>>): Promise<void>
  setPrimary(id: string): Promise<void>
  remove(id: string): Promise<void>
}

export type NewStoredAccount = {
  name: string
  type: string
  balanceUsd: number
  isLiability: boolean
  sortOrder?: number
}

export interface AccountRepo {
  list(): Promise<StoredAccount[]>
  create(input: NewStoredAccount): Promise<StoredAccount>
  update(id: string, patch: Partial<Omit<StoredAccount, 'id' | 'createdAt' | 'updatedAt'>>): Promise<void>
  remove(id: string): Promise<void>
  // Mirror bank balances: upsert one row per plaidAccountId (refreshed each
  // sync). Bank-synced rows render read-only in clients.
  upsertByPlaidAccountId(rows: NewPlaidAccount[]): Promise<void>
  // Reconcile: drop mirrored rows whose plaidAccountId is no longer returned
  // (account closed) or on unlink.
  removeByPlaidAccountIds(plaidAccountIds: string[]): Promise<number>
}

export interface WalletRepo {
  get(): Promise<StoredWallet>
  saveXpub(xpub: string, balanceBtc: number): Promise<void>
  setManualBalance(balanceBtc: number): Promise<void>
  setBalance(balanceBtc: number): Promise<void> // refresh result for the current xpub
  addSnapshot(s: Omit<StoredSnapshot, 'id'>): Promise<void>
  listSnapshots(): Promise<StoredSnapshot[]>
  clear(): Promise<void>
}

export interface SettingsRepo {
  get(): Promise<StoredSettings>
  patch(p: Partial<Omit<StoredSettings, 'updatedAt'>>): Promise<void>
}

export type NewPlaidItem = {
  itemId: string
  institutionId?: string | null
  institutionName?: string | null
  status?: 'active' | 'login_required' | 'removed'
  lastSyncedAt?: string | null
}

export interface PlaidItemRepo {
  list(): Promise<StoredPlaidItem[]>
  // Upsert by itemId (relinking the same bank refreshes status/lastSyncedAt).
  upsert(input: NewPlaidItem): Promise<StoredPlaidItem>
  remove(itemId: string): Promise<void>
}

export type ImportMode = 'replace' | 'merge'
export type ImportReport = { transactions: number; goals: number; accounts: number }

export interface StorageProvider {
  readonly kind: 'json-file' | 'local-storage' | 'indexeddb' | 'sqlite' | 'supabase'
  /** Open/load the backing store. Must be called (and awaited) before any repo use. */
  init(): Promise<void>
  transactions: TransactionRepo
  goals: GoalRepo
  accounts: AccountRepo
  wallet: WalletRepo
  plaidItems: PlaidItemRepo
  settings: SettingsRepo
  exportAll(): Promise<CompassExport>
  importAll(raw: unknown, mode: ImportMode): Promise<ImportReport>
  /** Erase everything (the in-app "Erase all data"). */
  wipe(): Promise<void>
  /** Subscribe to any-mutation events; returns unsubscribe. Drives hook refetch. */
  subscribe(fn: () => void): () => void
}

export type { CompassData }
