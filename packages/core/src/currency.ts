// Client-side display currency singleton — the fiat analog of lib/price.ts's
// liveUsd. The app shell seeds it from user_settings.preferred_currency and
// updates it when the user changes the setting; module-level formatters read
// it at call time, so no prop threading (same pattern as usdToSats()).
//
// The one rule: amounts flowing through app code are ALWAYS USD. fmtFiat/
// usdToFiat convert at the display edge; fiatToUsd converts user input back
// before anything is stored or compared. Never convert before a comparison —
// thresholds, goal progress, and aggregations are USD-to-USD.

import { CURRENCIES, type CurrencyCode } from './currencies'
import { getFxRate } from './price'

let activeCurrency: CurrencyCode = 'USD'

export const getActiveCurrency = () => activeCurrency
export function setActiveCurrency(code: CurrencyCode) {
  activeCurrency = code
}

export const getActiveCurrencyDef = () => CURRENCIES[activeCurrency]
export const getActiveSymbol = () => CURRENCIES[activeCurrency].symbol

// Units of active fiat per USD.
export const getActiveFx = () => getFxRate(activeCurrency)

export const usdToFiat = (usd: number) => Number(usd) * getActiveFx()
export const fiatToUsd = (fiat: number) => Number(fiat) / getActiveFx()

// Format a fiat amount that is ALREADY in the active currency (no conversion).
// Use for values born in fiat — e.g. the BTC price from getBtcPriceIn(), or
// echoing back raw user input. Using fmtFiat on these double-converts.
export function fmtFiatRaw(fiat: number, dp: number = 0): string {
  const def = CURRENCIES[activeCurrency]
  const d = Math.min(dp, def.maxDecimals)
  const v = Number(fiat)
  return (
    (v < 0 ? '-' : '') +
    def.symbol +
    Math.abs(v).toLocaleString(def.locale, { minimumFractionDigits: d, maximumFractionDigits: d })
  )
}

// Format a USD amount in the active currency (converts, then formats).
// Drop-in replacement for the old fmtUsd(n, dp) call sites — those all pass
// USD-denominated values. dp is clamped for zero-decimal currencies (JPY).
export const fmtFiat = (usd: number, dp: number = 0) => fmtFiatRaw(usdToFiat(usd), dp)
