// UUIDv7 — time-ordered, client-generated. Every persisted row uses these so
// ids sort chronologically and merge cleanly across devices (sync later).
// Plain number math (no BigInt) so ES2017 build targets stay happy; a 48-bit
// millisecond timestamp is exact within Number.MAX_SAFE_INTEGER until year ~10889.

export function uuidv7(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)

  let ts = Date.now()
  for (let i = 5; i >= 0; i--) {
    bytes[i] = ts % 256
    ts = Math.floor(ts / 256)
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x70 // version 7
  bytes[8] = (bytes[8] & 0x3f) | 0x80 // RFC 4122 variant

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
