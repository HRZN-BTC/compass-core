import { ed25519 } from '@noble/curves/ed25519.js';

// Ed25519 public key — paired with LICENSE_PRIVATE_KEY env var on the server.
// Embedded here so the desktop app can verify certs fully offline.
const LICENSE_PUBLIC_KEY_HEX = '8d39400e176036500301fe8cfac8cb7632a0a1d3ea8cbf892257bc2d7c27bc43';

function hexToBytes(hex: string): Uint8Array {
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < arr.length; i++) {
    arr[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return arr;
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

// ── Certificate ────────────────────────────────────────────────────────────────
// A LicenseCert is returned by /api/license/activate and stored locally by the
// desktop app. It proves plan + expiry offline via Ed25519 — no server call
// needed to verify a cert whose sig checks out against the embedded public key.

export interface LicenseCert {
  key: string;
  plan: string;
  issuedAt: number;  // unix seconds
  expiresAt: number; // unix seconds; 0 = lifetime / never expires
  sig: string;       // base64 Ed25519 signature
}

function certMsg(c: LicenseCert): Uint8Array {
  return new TextEncoder().encode(`${c.key}|${c.plan}|${c.issuedAt}|${c.expiresAt}`);
}

export function verifyLicenseCert(cert: LicenseCert): boolean {
  try {
    const pubKey = hexToBytes(LICENSE_PUBLIC_KEY_HEX);
    const sig = b64ToBytes(cert.sig);
    return ed25519.verify(sig, certMsg(cert), pubKey);
  } catch {
    return false;
  }
}

export function isCertExpired(cert: LicenseCert): boolean {
  if (cert.expiresAt === 0) return false; // lifetime — never expires
  return Math.floor(Date.now() / 1000) > cert.expiresAt;
}

// ── Key format ─────────────────────────────────────────────────────────────────
// CMP-XXXXX-XXXXX-XXXXX-XXXXX (20 chars, unambiguous charset: no I/O/0/1)

export function isValidKeyFormat(key: string): boolean {
  return /^CMP-[A-Z2-9]{5}-[A-Z2-9]{5}-[A-Z2-9]{5}-[A-Z2-9]{5}$/.test(
    key.trim().toUpperCase()
  );
}

export function normalizeKey(key: string): string {
  return key.trim().toUpperCase();
}

// ── Trial length (single source of truth) ───────────────────────────────────────
// One constant drives the free-trial length everywhere: the desktop local trial,
// the Stripe subscription trial (re-exported by apps/web/lib/stripe.ts), and all
// UI copy. Change it here to change it across the whole app.
export const TRIAL_DAYS = 30;
export const TRIAL_SECONDS = TRIAL_DAYS * 24 * 60 * 60;

// ── Trial license ──────────────────────────────────────────────────────────────
// Generated locally on first launch. No server call required — the desktop app
// stores this in its encrypted JSON store.

export interface TrialLicense {
  plan: 'trial';
  createdAt: number;
  expiresAt: number;
}

export function createTrialLicense(): TrialLicense {
  const now = Math.floor(Date.now() / 1000);
  return { plan: 'trial', createdAt: now, expiresAt: now + TRIAL_SECONDS };
}

export function isTrialExpired(trial: TrialLicense): boolean {
  return Math.floor(Date.now() / 1000) > trial.expiresAt;
}

export function trialDaysLeft(trial: TrialLicense): number {
  const secs = trial.expiresAt - Math.floor(Date.now() / 1000);
  return Math.max(0, Math.ceil(secs / 86400));
}

// ── Cached verify response ─────────────────────────────────────────────────────
// Stored alongside the cert after each successful /verify call.
// Grace period: 30 days — app works offline if last_verified is within this window.

export const OFFLINE_GRACE_SECONDS = 30 * 24 * 60 * 60;

export interface CachedVerify {
  verifiedAt: number; // unix seconds
  plan: string;
  expiresAt: number;  // 0 = lifetime
}

export function isWithinGrace(cached: CachedVerify): boolean {
  return Math.floor(Date.now() / 1000) - cached.verifiedAt < OFFLINE_GRACE_SECONDS;
}

// ── Resolved status ─────────────────────────────────────────────────────────────
// Single source of truth for "is this install entitled right now", computed
// offline from stored fields. The desktop app calls this each launch/render.

export type LicenseState =
  | 'active'         // valid paid license (sub in period, or lifetime)
  | 'grace'          // sub cert expired but within 30-day offline grace — re-verify soon
  | 'trial'          // in the free trial (see TRIAL_DAYS)
  | 'trial_expired'  // trial ran out, no key
  | 'expired'        // paid license lapsed past grace
  | 'invalid'        // cert present but signature/format bad
  | 'none';          // nothing entered yet

export interface LicenseStatus {
  state: LicenseState;
  entitled: boolean;         // may the app be used
  plan: string | null;       // 'monthly' | 'annual' | 'lifetime' | 'trial' | null
  trialDaysLeft: number | null;
  expiresAt: number | null;  // unix secs; 0/null = never
  needsReverify: boolean;    // sub whose cert should be refreshed online
}

export interface LicenseFields {
  licenseKey: string | null;
  licenseCert: string | null;     // JSON of LicenseCert
  licenseCheckedAt: string | null; // ISO
  trialStartedAt: string | null;   // ISO
}

const REVERIFY_AFTER_SECONDS = 25 * 24 * 60 * 60; // refresh a bit before the 30-day grace edge

export function resolveLicenseStatus(f: LicenseFields, nowMs = Date.now()): LicenseStatus {
  const nowSec = Math.floor(nowMs / 1000);

  // 1. A cert takes precedence over trial.
  if (f.licenseCert) {
    let cert: LicenseCert | null = null;
    try {
      cert = JSON.parse(f.licenseCert) as LicenseCert;
    } catch {
      cert = null;
    }
    if (!cert || !verifyLicenseCert(cert)) {
      return { state: 'invalid', entitled: false, plan: null, trialDaysLeft: null, expiresAt: null, needsReverify: false };
    }
    // Lifetime — never expires, never needs the server again.
    if (cert.expiresAt === 0) {
      return { state: 'active', entitled: true, plan: cert.plan, trialDaysLeft: null, expiresAt: 0, needsReverify: false };
    }
    const checkedAtSec = f.licenseCheckedAt ? Math.floor(new Date(f.licenseCheckedAt).getTime() / 1000) : 0;
    const staleReverify = nowSec - checkedAtSec > REVERIFY_AFTER_SECONDS;
    if (nowSec <= cert.expiresAt) {
      // In period. Nudge a re-verify as the check ages so renewals refresh the cert.
      return { state: 'active', entitled: true, plan: cert.plan, trialDaysLeft: null, expiresAt: cert.expiresAt, needsReverify: staleReverify };
    }
    // Cert expired. Keep working through the offline grace window measured from
    // the last successful server check, then lock.
    if (checkedAtSec && nowSec - checkedAtSec < OFFLINE_GRACE_SECONDS) {
      return { state: 'grace', entitled: true, plan: cert.plan, trialDaysLeft: null, expiresAt: cert.expiresAt, needsReverify: true };
    }
    return { state: 'expired', entitled: false, plan: cert.plan, trialDaysLeft: null, expiresAt: cert.expiresAt, needsReverify: true };
  }

  // 2. No cert — trial path.
  if (f.trialStartedAt) {
    const startSec = Math.floor(new Date(f.trialStartedAt).getTime() / 1000);
    const endSec = startSec + TRIAL_SECONDS;
    if (nowSec <= endSec) {
      return {
        state: 'trial',
        entitled: true,
        plan: 'trial',
        trialDaysLeft: Math.max(0, Math.ceil((endSec - nowSec) / 86400)),
        expiresAt: endSec,
        needsReverify: false,
      };
    }
    return { state: 'trial_expired', entitled: false, plan: 'trial', trialDaysLeft: 0, expiresAt: endSec, needsReverify: false };
  }

  // 3. Nothing yet.
  return { state: 'none', entitled: false, plan: null, trialDaysLeft: null, expiresAt: null, needsReverify: false };
}
