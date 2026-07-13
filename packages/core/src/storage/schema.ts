// Canonical persisted schema. This exact shape is what lands (encrypted) in the
// local store file, and what `.compass` backups and future sync blobs carry —
// one format everywhere, versioned for forward migration.

export type TxnCategory = 'bitcoin' | 'necessary' | 'discretionary' | 'wasteful' | 'income'

export type StoredTxn = {
  id: string // uuidv7
  date: string // YYYY-MM-DD (local)
  merchant: string
  amountUsd: number
  category: TxnCategory
  icon: string
  note: string | null
  source: string // manual | csv | wallet | migrated
  btcPriceUsd: number | null // frozen BTC/USD on date; null = unstamped
  createdAt: string // ISO
  updatedAt: string // ISO
}

export type StoredGoal = {
  id: string
  name: string
  unit: 'btc' | 'usd'
  type: string
  target: number // in the goal's own unit
  saved: number
  monthly: number
  isPrimary: boolean
  createdAt: string
  updatedAt: string
}

export type StoredAccount = {
  id: string
  name: string
  type: string // Cash | Savings | Investments | Retirement | Property | Other
  balanceUsd: number
  isLiability: boolean
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export type StoredWallet = {
  // 'xpub' = watch-only wallet scanned on-device; 'manual' = user-entered balance.
  mode: 'xpub' | 'manual' | null
  // Plaintext INSIDE the store: the whole file is encrypted at rest and the
  // xpub never leaves the device. Never log or export this unencrypted.
  xpub: string | null
  balanceBtc: number
  lastScanAt: string | null
  updatedAt: string
}

export type StoredSnapshot = {
  id: string
  ts: string // ISO
  balanceSats: number
  priceUsd: number
}

export type StoredReflection = {
  id: string
  year: number
  month: number // 1-12
  status: 'building' | 'complete'
  spendNecessaryUsd: number
  spendDiscretionaryUsd: number
  spendWastefulUsd: number
  totalSpendSats: number
  accumBtc: number
  prevAccumBtc: number | null
  goalImpactDays: number | null
  updatedAt: string
}

export type StoredSettings = {
  displayName: string
  defaultUnit: 'btc' | 'usd'
  denomination: 'sats' | 'btc'
  preferredCurrency: string
  wastefulName: string
  // Esplora/mempool API base for wallet scans; null = mempool.space default.
  btcEndpoint: string | null
  // Last successful .compass backup (ISO); drives the "back up your data" nudge.
  lastBackupAt: string | null
  // Entered license key (verified offline via Ed25519). Null = trial.
  licenseKey: string | null
  // Signed Ed25519 cert from /api/license/activate, JSON-stringified. Proves
  // plan + expiry offline — verified against the pubkey embedded in @compass/core.
  licenseCert: string | null
  // Last successful server /verify (ISO). Drives the 30-day offline grace for
  // subscriptions; lifetime certs never need re-verification.
  licenseCheckedAt: string | null
  // How the license was purchased ('stripe' | 'btcpay'). Set by the in-app
  // checkout on claim; null for manual key activation (unknown). Bitcoin subs
  // don't auto-renew, so the UI shows days-remaining only when 'btcpay'.
  licenseProvider: 'stripe' | 'btcpay' | null
  // Stable per-install device id, generated on first activation. Used to cap a
  // license to N devices server-side.
  deviceId: string | null
  // First-run trial start (ISO). Set when the user continues without a key.
  trialStartedAt: string | null
  onboardingCompleted: boolean
  onboardingAnswers: Record<string, unknown> | null
  updatedAt: string
}

export type CompassData = {
  transactions: StoredTxn[]
  goals: StoredGoal[]
  accounts: StoredAccount[]
  wallet: StoredWallet
  snapshots: StoredSnapshot[]
  reflections: StoredReflection[]
  settings: StoredSettings
  meta: { createdAt: string }
}

export const STORE_VERSION = 1

// Envelope used for the store file, `.compass` backups, and sync payloads.
export type CompassExport = {
  format: 'compass-store'
  version: number
  exportedAt: string
  data: CompassData
}

export function emptyData(now = new Date().toISOString()): CompassData {
  return {
    transactions: [],
    goals: [],
    accounts: [],
    wallet: { mode: null, xpub: null, balanceBtc: 0, lastScanAt: null, updatedAt: now },
    snapshots: [],
    reflections: [],
    settings: {
      displayName: '',
      defaultUnit: 'btc',
      denomination: 'sats',
      preferredCurrency: 'USD',
      wastefulName: 'Wasteful',
      btcEndpoint: null,
      lastBackupAt: null,
      licenseKey: null,
      licenseCert: null,
      licenseCheckedAt: null,
      licenseProvider: null,
      deviceId: null,
      trialStartedAt: null,
      onboardingCompleted: false,
      onboardingAnswers: null,
      updatedAt: now,
    },
    meta: { createdAt: now },
  }
}

// Parse + migrate a raw store/backup payload to the current version.
// Version bumps add cases here; unknown newer versions throw (never silently
// drop data written by a newer app).
export function migrateExport(raw: unknown): CompassData {
  const env = raw as Partial<CompassExport>
  if (!env || env.format !== 'compass-store' || typeof env.version !== 'number' || !env.data) {
    throw new Error('Not a Compass store file')
  }
  if (env.version > STORE_VERSION) {
    throw new Error(`Store written by a newer Compass (v${env.version}); update the app`)
  }
  const data = env.data as CompassData
  // Backfill settings keys added in later versions so an older store gains new
  // fields (e.g. licenseCert) with their defaults instead of undefined.
  data.settings = { ...emptyData().settings, ...data.settings }
  return data
}

export function toExport(data: CompassData): CompassExport {
  return { format: 'compass-store', version: STORE_VERSION, exportedAt: new Date().toISOString(), data }
}
