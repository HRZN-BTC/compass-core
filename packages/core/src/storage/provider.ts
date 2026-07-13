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
  StoredReflection,
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

export interface TransactionRepo {
  list(): Promise<StoredTxn[]>
  create(input: NewStoredTxn): Promise<StoredTxn>
  update(id: string, patch: Partial<Omit<StoredTxn, 'id' | 'createdAt' | 'updatedAt'>>): Promise<void>
  remove(id: string): Promise<void>
  bulkUpsert(rows: StoredTxn[]): Promise<number>
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

export interface ReflectionRepo {
  list(): Promise<StoredReflection[]>
  upsertMonth(r: Omit<StoredReflection, 'id' | 'updatedAt'>): Promise<void>
}

export interface SettingsRepo {
  get(): Promise<StoredSettings>
  patch(p: Partial<Omit<StoredSettings, 'updatedAt'>>): Promise<void>
}

export type ImportMode = 'replace' | 'merge'
export type ImportReport = { transactions: number; goals: number; accounts: number; reflections: number }

export interface StorageProvider {
  readonly kind: 'json-file' | 'local-storage' | 'indexeddb' | 'sqlite' | 'supabase'
  /** Open/load the backing store. Must be called (and awaited) before any repo use. */
  init(): Promise<void>
  transactions: TransactionRepo
  goals: GoalRepo
  accounts: AccountRepo
  wallet: WalletRepo
  reflections: ReflectionRepo
  settings: SettingsRepo
  exportAll(): Promise<CompassExport>
  importAll(raw: unknown, mode: ImportMode): Promise<ImportReport>
  /** Erase everything (the in-app "Erase all data"). */
  wipe(): Promise<void>
  /** Subscribe to any-mutation events; returns unsubscribe. Drives hook refetch. */
  subscribe(fn: () => void): () => void
}

export type { CompassData }
