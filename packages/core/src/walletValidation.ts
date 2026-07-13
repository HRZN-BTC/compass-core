// Pure xpub/ypub/zpub validation + formatting. No network, no Node-only APIs —
// safe to import from client components. Server-side balance fetching lives in
// ./wallet (which re-exports these for back-compat). Read-only: we never accept
// private keys or mnemonics.

import bs58check from 'bs58check'

const XPUB_PREFIXES = ['xpub', 'ypub', 'zpub', 'Ypub', 'Zpub']

// Length in bytes of a decoded BIP32 extended key: 4 version + 1 depth +
// 4 fingerprint + 4 child number + 32 chain code + 33 key = 78.
const EXTENDED_KEY_BYTES = 78

export type XpubValidationError =
  | 'empty'
  | 'looks_like_mnemonic'
  | 'looks_like_private_key'
  | 'bad_prefix'
  | 'bad_length'
  | 'invalid_key'

export type XpubValidation =
  | { ok: true; xpub: string }
  | { ok: false; reason: XpubValidationError }

export function validateXpub(raw: string): XpubValidation {
  const s = raw.trim()
  if (!s) return { ok: false, reason: 'empty' }

  const wordCount = s.split(/\s+/).filter(Boolean).length
  if (wordCount >= 12) return { ok: false, reason: 'looks_like_mnemonic' }

  if (/^[5KL][1-9A-HJ-NP-Za-km-z]{50,51}$/.test(s)) {
    return { ok: false, reason: 'looks_like_private_key' }
  }

  if (!XPUB_PREFIXES.some((p) => s.startsWith(p))) {
    return { ok: false, reason: 'bad_prefix' }
  }

  // Enforce base58 charset (prefix + base58 body). Without this, characters like
  // `/ ? # .` would pass and get injected into the outbound Blockbook URL path.
  if (!/^[xyzYZ]pub[1-9A-HJ-NP-Za-km-z]+$/.test(s)) {
    return { ok: false, reason: 'bad_prefix' }
  }

  if (s.length < 100 || s.length > 120) {
    return { ok: false, reason: 'bad_length' }
  }

  // Final gate: verify the base58check checksum and the 78-byte extended-key
  // payload. Catches single-character typos that pass the charset/length checks
  // but would otherwise fail downstream as a misleading "network" error.
  try {
    const payload = bs58check.decode(s)
    if (payload.length !== EXTENDED_KEY_BYTES) return { ok: false, reason: 'invalid_key' }
  } catch {
    return { ok: false, reason: 'invalid_key' }
  }

  return { ok: true, xpub: s }
}

export function truncateXpub(xpub: string, head = 6, tail = 4): string {
  if (xpub.length <= head + tail + 1) return xpub
  return `${xpub.slice(0, head)}…${xpub.slice(-tail)}`
}
