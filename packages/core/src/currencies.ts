// Supported display currencies. Storage is ALWAYS USD (amount_usd, cash_usd,
// btc_price_usd, …) — these definitions only drive display/input conversion.
// Mirrored in the mobile repo (src/lib/currencies.ts) and in the DB CHECK
// constraint on user_settings.preferred_currency; keep all three in sync.

export type CurrencyCode = 'USD' | 'CAD' | 'AUD' | 'EUR' | 'GBP' | 'INR' | 'JPY' | 'CHF'

export const CURRENCY_CODES: CurrencyCode[] = ['USD', 'CAD', 'AUD', 'EUR', 'GBP', 'INR', 'JPY', 'CHF']

export type CurrencyDef = {
  code: CurrencyCode
  symbol: string
  label: string
  // Grouping locale passed to toLocaleString (en-IN gives lakh grouping).
  locale: string
  // JPY has no minor unit — fmtFiat clamps any dp argument to this.
  maxDecimals: number
}

// CAD/AUD use a plain '$': the app shows one currency at a time, so 'CA$'-style
// disambiguation is noise for a user viewing their own currency.
export const CURRENCIES: Record<CurrencyCode, CurrencyDef> = {
  USD: { code: 'USD', symbol: '$', label: 'US Dollar', locale: 'en-US', maxDecimals: 2 },
  CAD: { code: 'CAD', symbol: '$', label: 'Canadian Dollar', locale: 'en-US', maxDecimals: 2 },
  AUD: { code: 'AUD', symbol: '$', label: 'Australian Dollar', locale: 'en-US', maxDecimals: 2 },
  EUR: { code: 'EUR', symbol: '€', label: 'Euro', locale: 'en-US', maxDecimals: 2 },
  GBP: { code: 'GBP', symbol: '£', label: 'British Pound', locale: 'en-US', maxDecimals: 2 },
  // en-IN = Indian-system lakh/crore grouping (58,79,737), the standard way
  // numbers are written in India. Flip to 'en-US' for Western grouping.
  INR: { code: 'INR', symbol: '₹', label: 'Indian Rupee', locale: 'en-IN', maxDecimals: 2 },
  JPY: { code: 'JPY', symbol: '¥', label: 'Japanese Yen', locale: 'en-US', maxDecimals: 0 },
  CHF: { code: 'CHF', symbol: 'CHF ', label: 'Swiss Franc', locale: 'en-US', maxDecimals: 2 },
}

export const isCurrencyCode = (v: unknown): v is CurrencyCode =>
  typeof v === 'string' && (CURRENCY_CODES as string[]).includes(v)

// Last-resort FX seeds (units per USD) — the FX analog of FALLBACK_BTC_PRICE.
// Used only when CoinGecko is down AND no fetched rate has been cached this
// runtime. Realistically only INR ever hits this (the mempool fallback covers
// the other seven natively).
export const FALLBACK_FX: Record<CurrencyCode, number> = {
  USD: 1,
  CAD: 1.42,
  AUD: 1.44,
  EUR: 0.87,
  GBP: 0.75,
  INR: 95,
  JPY: 161,
  CHF: 0.8,
}
