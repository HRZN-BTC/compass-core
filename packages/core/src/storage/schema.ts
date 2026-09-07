// Canonical persisted schema. This exact shape is what lands (encrypted) in the
// local store file, and what `.compass` backups and future sync blobs carry —
// one format everywhere, versioned for forward migration.

export type TxnCategory = 'bitcoin' | 'necessary' | 'discretionary' | 'wasteful' | 'income'

export type StoredTxn = {
  id: string // uuidv7
  date: string // YYYY-MM-DD (local)
  // When the purchase actually happened, when the source reports it (Plaid
  // authorized_datetime/datetime). Optional so stores written before this
  // existed keep loading; manual entries and banks that send no time leave it
  // unset and order within their day by createdAt instead.
  at?: string | null
  merchant: string
  amountUsd: number
  category: TxnCategory
  icon: string
  note: string | null
  source: string // manual | csv | wallet | migrated | plaid
  // Set on bank-synced rows (source === 'plaid'). Dedup key for replay-safe
  // sync; presence makes the row read-only-except-recategorize in clients.
  plaidTransactionId?: string | null
  plaidAccountId?: string | null
  // Set on rows posted by a recurring item (source === 'recurring'). Kept when
  // the item is deleted — the spending still happened — so the badge is the
  // only thing that goes away.
  recurringId?: string | null
  btcPriceUsd: number | null // frozen BTC/USD on date; null = unstamped
  createdAt: string // ISO
  updatedAt: string // ISO
}

// A recurring commitment — rent, a subscription, a weekly DCA. A template, not
// a ledger entry: the poster reads it and writes real StoredTxn rows on their
// due dates, each carrying recurringId back to here.
export type StoredRecurring = {
  id: string
  merchant: string
  amountUsd: number
  category: TxnCategory
  icon: string
  note: string | null
  cadence: 'daily' | 'weekly' | 'monthly' | 'yearly'
  // First occurrence, YYYY-MM-DD. Later dates are computed as anchor + N
  // periods rather than by advancing the previous one, so a monthly item
  // anchored on the 31st clamps into February and returns to the 31st in March
  // instead of drifting earlier every short month.
  anchorDate: string
  // Cache of the next unposted occurrence; derivable from anchorDate at any time.
  nextDue: string
  // Set = paused. Nothing posts while non-null, and unpausing resumes from
  // today rather than back-filling the gap.
  pausedAt: string | null
  createdAt: string
  updatedAt: string
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
  // Set = mirrored from a connected bank (read-only in clients; refreshed each
  // sync, removed on reconcile/unlink).
  plaidAccountId?: string | null
  createdAt: string
  updatedAt: string
}

// A connected bank/institution. The access token + sync cursor live server-side
// (license-scoped relay) — never on the device — so this local row carries only
// display + status metadata.
export type StoredPlaidItem = {
  id: string
  itemId: string
  institutionId: string | null
  institutionName: string | null
  status: 'active' | 'login_required' | 'removed'
  lastSyncedAt: string | null
  createdAt: string
  updatedAt: string
}

// A locally generated notification.
//
// Desktop has no Supabase account (identity is a license key by email), so the
// server-side producers that write public.notifications for mobile and web have
// no user to write for. The desktop app evaluates the same conditions against
// its own encrypted store instead — same shape on screen, no network.
//
// dedupeKey mirrors the notifications_dedupe unique index on the server: the
// generator runs on every app open and after every sync, so "already told them
// this" has to be cheap and exact.
export type StoredNotification = {
  id: string
  type: string
  title: string
  subtitle: string | null
  icon: string
  // Canonical destination key ('spending' | 'goals' | 'bitcoin' | 'banks'),
  // not a route — the same vocabulary the server-side producers write.
  deepLink: string | null
  read: boolean
  dedupeKey: string | null
  createdAt: string
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

export type StoredSettings = {
  displayName: string
  defaultUnit: 'btc' | 'usd'
  denomination: 'sats' | 'btc'
  preferredCurrency: string
  // When on, the net worth hero starts blurred each load (tap to reveal).
  blurNetWorthOnStart: boolean
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
  // First run of the local notification generator (ISO), or null.
  //
  // Goal milestones are evaluated from current state rather than from a
  // crossing, so without this an existing store would announce every threshold
  // it had already passed the first time the feature ships. The first run
  // records this and stays quiet; later runs report real progress.
  notificationsInitializedAt: string | null
  // Transaction source mode. 'auto' = bank-synced via Plaid (manual entry
  // paused, except the Bitcoin balance); 'manual' = local-only default.
  txnMode: 'manual' | 'auto'
  onboardingCompleted: boolean
  onboardingAnswers: Record<string, unknown> | null
  updatedAt: string
}

export type CompassData = {
  transactions: StoredTxn[]
  recurring: StoredRecurring[]
  goals: StoredGoal[]
  accounts: StoredAccount[]
  wallet: StoredWallet
  snapshots: StoredSnapshot[]
  plaidItems: StoredPlaidItem[]
  notifications: StoredNotification[]
  // Dedupe keys of notifications the user cleared. The generator re-evaluates
  // every condition on each app open and dedupes against existing rows, so
  // without these a cleared feed would refill itself with anything still true.
  // prune() drops a tombstone once its key can no longer be produced.
  notificationTombstones: string[]
  settings: StoredSettings
  meta: { createdAt: string }
}

// v2: added plaidItems[], StoredTxn.plaid*, StoredAccount.plaidAccountId,
// settings.txnMode.
// v3: added notifications[].
// v4: added notificationTombstones[].
// v5: added recurring[], StoredTxn.recurringId.
// All additive; migrateExport backfills older stores.
export const STORE_VERSION = 5

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
    recurring: [],
    goals: [],
    accounts: [],
    wallet: { mode: null, xpub: null, balanceBtc: 0, lastScanAt: null, updatedAt: now },
    snapshots: [],
    plaidItems: [],
    notifications: [],
    notificationTombstones: [],
    settings: {
      displayName: '',
      defaultUnit: 'btc',
      denomination: 'sats',
      preferredCurrency: 'USD',
      blurNetWorthOnStart: false,
      wastefulName: 'Wasteful',
      btcEndpoint: null,
      lastBackupAt: null,
      licenseKey: null,
      licenseCert: null,
      licenseCheckedAt: null,
      notificationsInitializedAt: null,
      licenseProvider: null,
      deviceId: null,
      trialStartedAt: null,
      txnMode: 'manual',
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
  // fields (e.g. licenseCert, txnMode) with their defaults instead of undefined.
  data.settings = { ...emptyData().settings, ...data.settings }
  // v2: plaidItems added — older stores/backups have none.
  if (!Array.isArray(data.plaidItems)) data.plaidItems = []
  // v3: notifications added. Left empty rather than back-generated — telling
  // someone about a budget they blew three months ago helps nobody.
  if (!Array.isArray(data.notifications)) data.notifications = []
  // v4: tombstones added. An older store has cleared nothing, so an empty list
  // is the correct starting state rather than a lossy default.
  if (!Array.isArray(data.notificationTombstones)) data.notificationTombstones = []
  // v5: recurring added. Empty is correct for an older store — it had no
  // recurring items, so there is nothing to post and nothing to back-date.
  if (!Array.isArray(data.recurring)) data.recurring = []
  // Reflections were removed from the product. Stores written before that still
  // carry the array; drop it rather than reject the file, so old backups import.
  delete (data as { reflections?: unknown }).reflections
  return data
}

export function toExport(data: CompassData): CompassExport {
  return { format: 'compass-store', version: STORE_VERSION, exportedAt: new Date().toISOString(), data }
}
