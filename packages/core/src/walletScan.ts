// BIP32 address derivation + a transport-agnostic gap-limit scan.
//
// This module owns the *pure* half of a wallet scan: turning an extended public
// key into concrete addresses, script pubkeys and Electrum scripthashes, and
// running the discovery loop. It never talks to the network itself — the caller
// injects a BalanceResolver. That split is what lets the same scan run over
// batched Electrum JSON-RPC (apps/web) and over per-address HTTP (desktop,
// ./walletDerived) without forking the derivation logic.
//
// Works server-side and client-side (pure JS, no Node.js-only APIs).

import { secp256k1 } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha256'
import { ripemd160 } from '@noble/hashes/ripemd160'
import { hmac } from '@noble/hashes/hmac'
import { sha512 } from '@noble/hashes/sha512'
import bs58check from 'bs58check'
import { bech32, bech32m } from 'bech32'

// ─── Crypto primitives ────────────────────────────────────────────────────────

function bytesToHex(b: Uint8Array): string {
  return Array.from(b)
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('')
}

function hash160(data: Uint8Array): Uint8Array {
  return ripemd160(sha256(data))
}

// BIP340 tagged hash: SHA256(SHA256(tag) || SHA256(tag) || msg).
function taggedHash(tag: string, msg: Uint8Array): Uint8Array {
  const t = sha256(new TextEncoder().encode(tag))
  const buf = new Uint8Array(t.length * 2 + msg.length)
  buf.set(t, 0)
  buf.set(t, t.length)
  buf.set(msg, t.length * 2)
  return sha256(buf)
}

// ─── BIP32 xpub parsing ───────────────────────────────────────────────────────

// bs58check.decode strips the 4-byte checksum. The remaining 78-byte payload:
// [0-3]   version (4 bytes)
// [4]     depth
// [5-8]   fingerprint
// [9-12]  child index
// [13-44] chain code (32 bytes)
// [45-77] compressed public key (33 bytes)
export type ParsedXpub = { pubkey: Uint8Array; chainCode: Uint8Array }

export function parseXpub(key: string): ParsedXpub {
  const payload = new Uint8Array(bs58check.decode(key))
  if (payload.length < 78) throw new Error('Invalid xpub: unexpected length')
  return {
    chainCode: payload.slice(13, 45),
    pubkey: payload.slice(45, 78),
  }
}

// ─── BIP32 non-hardened child key derivation ─────────────────────────────────

// Non-hardened: index < 0x80000000. Requires only the parent public key +
// chain code (no private key). Hardened derivation is impossible from xpub.
export function deriveChild(
  parentPubkey: Uint8Array,
  parentChainCode: Uint8Array,
  index: number,
): { pubkey: Uint8Array; chainCode: Uint8Array } {
  const data = new Uint8Array(37)
  data.set(parentPubkey, 0)
  data[33] = (index >>> 24) & 0xff
  data[34] = (index >>> 16) & 0xff
  data[35] = (index >>> 8) & 0xff
  data[36] = index & 0xff

  const I = hmac(sha512, parentChainCode, data)
  const IL = I.slice(0, 32)
  const IR = I.slice(32)

  // child_pubkey = IL·G + parent_pubkey  (EC point addition)
  const ILn = BigInt('0x' + bytesToHex(IL))
  const childPt = secp256k1.Point.BASE.multiply(ILn).add(
    secp256k1.Point.fromHex(bytesToHex(parentPubkey)),
  )

  return { pubkey: childPt.toBytes(true), chainCode: new Uint8Array(IR) }
}

// ─── Script pubkeys and addresses ─────────────────────────────────────────────

export type ScriptType = 'p2pkh' | 'p2shP2wpkh' | 'p2wpkh' | 'p2tr'

// BIP86 key-path output key: tweak the internal key by
// t = taggedHash("TapTweak", xonly(P)), lifting P to even-Y first.
function taprootOutputKey(pubkey: Uint8Array): Uint8Array {
  const xonly = pubkey.slice(1)
  const t = BigInt('0x' + bytesToHex(taggedHash('TapTweak', xonly)))
  const P = secp256k1.Point.fromHex(bytesToHex(pubkey))
  // BigInt(2)/BigInt(0) rather than 2n/0n — the web tsconfig targets below
  // ES2020, where BigInt literals are a syntax error.
  const lifted = P.toAffine().y % BigInt(2) === BigInt(0) ? P : P.negate()
  const Q = lifted.add(secp256k1.Point.BASE.multiply(t))
  return Q.toBytes(true).slice(1) // x-only
}

// The scriptPubKey is the canonical identity of an output — addresses are just
// its user-facing encoding, and Electrum indexes by a hash of THIS, not the
// address. So build the script first and derive the address from it.
export function scriptPubKeyFor(pubkey: Uint8Array, type: ScriptType): Uint8Array {
  switch (type) {
    case 'p2pkh': {
      // OP_DUP OP_HASH160 <20> OP_EQUALVERIFY OP_CHECKSIG
      const h = hash160(pubkey)
      const s = new Uint8Array(25)
      s[0] = 0x76
      s[1] = 0xa9
      s[2] = 0x14
      s.set(h, 3)
      s[23] = 0x88
      s[24] = 0xac
      return s
    }
    case 'p2shP2wpkh': {
      // OP_HASH160 <hash160(witnessProgram)> OP_EQUAL
      const witnessScript = new Uint8Array(22)
      witnessScript[0] = 0x00 // OP_0
      witnessScript[1] = 0x14 // OP_PUSHBYTES_20
      witnessScript.set(hash160(pubkey), 2)
      const s = new Uint8Array(23)
      s[0] = 0xa9
      s[1] = 0x14
      s.set(hash160(witnessScript), 2)
      s[22] = 0x87
      return s
    }
    case 'p2wpkh': {
      // OP_0 <20-byte keyhash>
      const s = new Uint8Array(22)
      s[0] = 0x00
      s[1] = 0x14
      s.set(hash160(pubkey), 2)
      return s
    }
    case 'p2tr': {
      // OP_1 <32-byte tweaked x-only key>
      const s = new Uint8Array(34)
      s[0] = 0x51
      s[1] = 0x20
      s.set(taprootOutputKey(pubkey), 2)
      return s
    }
  }
}

export function addressFor(pubkey: Uint8Array, type: ScriptType): string {
  switch (type) {
    case 'p2pkh': {
      const payload = new Uint8Array(21)
      payload[0] = 0x00
      payload.set(hash160(pubkey), 1)
      return bs58check.encode(payload)
    }
    case 'p2shP2wpkh': {
      const script = scriptPubKeyFor(pubkey, 'p2shP2wpkh')
      const payload = new Uint8Array(21)
      payload[0] = 0x05
      payload.set(script.slice(2, 22), 1)
      return bs58check.encode(payload)
    }
    case 'p2wpkh':
      return bech32.encode('bc', [0, ...bech32.toWords(hash160(pubkey))])
    case 'p2tr':
      // Witness v1 uses bech32m, not bech32 — a v1 address encoded with the
      // bech32 checksum is invalid and will not match the chain.
      return bech32m.encode('bc', [1, ...bech32m.toWords(taprootOutputKey(pubkey))])
  }
}

// Electrum indexes by scripthash: sha256 of the scriptPubKey, byte-reversed,
// hex. The reversal is Bitcoin's usual little-endian hash display convention.
// One fixed-width key covers every script type, which is why batched scripthash
// lookups scale where per-address HTTP endpoints do not.
export function electrumScriptHash(scriptPubKey: Uint8Array): string {
  return bytesToHex(sha256(scriptPubKey).slice().reverse())
}

// Which script types to scan for a given key prefix. A y/zpub pins its type via
// SLIP-132 version bytes. A bare xpub is AMBIGUOUS — Ledger and others export a
// plain xpub for segwit and taproot accounts alike — so it fans out to all four.
// No SLIP-132 prefix implies taproot (Sparrow's ExtendedKey.Header has no P2TR
// entry either), so p2tr is only ever reachable through this fan-out.
export function scriptTypesFor(key: string): ScriptType[] {
  if (key.startsWith('zpub') || key.startsWith('Zpub')) return ['p2wpkh']
  if (key.startsWith('ypub') || key.startsWith('Ypub')) return ['p2shP2wpkh']
  return ['p2pkh', 'p2shP2wpkh', 'p2wpkh', 'p2tr']
}

// ─── Scan targets ─────────────────────────────────────────────────────────────

export type ScanTarget = {
  type: ScriptType
  chain: 0 | 1
  index: number
  address: string
  scriptHash: string
}

export type TargetStats = {
  // Whether the address has ANY history. Must be true for an address that was
  // funded and then fully spent — such an address has a zero balance but still
  // resets the gap counter. Deciding "used" from balance alone silently
  // truncates the scan at the first emptied address.
  used: boolean
  satsConfirmed: number
  satsUnconfirmed: number
  txCount: number
}

// Resolves a batch of targets to their on-chain stats, in the same order.
// MUST throw rather than return zeroed stats on a fetch failure: a resolver
// that reports an unreachable address as "unused" both drops its balance and
// corrupts the gap count, which under-reports the wallet.
export type BalanceResolver = (
  targets: ScanTarget[],
  signal?: AbortSignal,
) => Promise<TargetStats[]>

// ─── Gap-limit scan ───────────────────────────────────────────────────────────

// BIP44 specifies a 20-address gap, and that is enough to decide whether a
// (scriptType × chain) pair is used at all. It is NOT enough to find every
// funded address inside a pair that IS used: wallets routinely hand out receive
// addresses that go unspent (QR shown, never paid), and a run of those can far
// exceed 20 — real accounts have been seen with a 35-address hole between two
// funded ones. Stopping at 20 silently under-reports the balance.
//
// So: probe with 20, and once a chain proves it is in use, keep walking until a
// much longer run of unused addresses. The wide limit is only ever paid on
// chains that actually hold coins, so an unused script type still costs 20.
export const PROBE_GAP_LIMIT = 20
export const ACTIVE_GAP_LIMIT = 100

export type XpubBalance = {
  btc: number
  satsConfirmed: number
  satsUnconfirmed: number
  txCount: number
  addressesScanned: number
}

const SATS_PER_BTC = 1e8

type ChainState = {
  type: ScriptType
  chain: 0 | 1
  derived: number // how many indices have been queried (contiguous from 0)
  highestUsed: number // -1 until a used address is seen
}

// Target child count for a chain, per Sparrow's model: keep `gap` derived
// addresses beyond the highest index WITH HISTORY (ElectrumServer.getGapLimitSize).
// Expressing it as a lookahead target rather than a consecutive-unused counter
// is what lets every pending chain be batched together in one round.
function targetFor(s: ChainState): number {
  const gap = s.highestUsed < 0 ? PROBE_GAP_LIMIT : ACTIVE_GAP_LIMIT
  return s.highestUsed + gap + 1
}

export async function scanXpub(
  xpub: string,
  resolve: BalanceResolver,
  opts?: {
    signal?: AbortSignal
    // Running count of addresses scanned. The total is unknown ahead of time
    // (the walk is open-ended), so callers get a count, not a percentage.
    onProgress?: (addressesScanned: number) => void
  },
): Promise<XpubBalance> {
  const parsed = parseXpub(xpub)

  // Chain-level keys (xpub/{chain}) are derived once and reused for every
  // address index — re-deriving per index would repeat an EC multiply per hop.
  const chainNodes = new Map<string, { pubkey: Uint8Array; chainCode: Uint8Array }>()
  const states: ChainState[] = []
  for (const type of scriptTypesFor(xpub)) {
    for (const chain of [0, 1] as const) {
      states.push({ type, chain, derived: 0, highestUsed: -1 })
      if (!chainNodes.has(String(chain))) {
        chainNodes.set(String(chain), deriveChild(parsed.pubkey, parsed.chainCode, chain))
      }
    }
  }

  let satsConfirmed = 0
  let satsUnconfirmed = 0
  let txCount = 0
  let addressesScanned = 0

  // Each round collects the outstanding range from EVERY chain that has not yet
  // reached its lookahead target, so one resolver call covers all script types
  // at once. A batching resolver turns the whole scan into a handful of round
  // trips instead of one request per address.
  for (;;) {
    const batch: ScanTarget[] = []
    for (const s of states) {
      const chainNode = chainNodes.get(String(s.chain))!
      for (let i = s.derived; i < targetFor(s); i++) {
        const child = deriveChild(chainNode.pubkey, chainNode.chainCode, i)
        batch.push({
          type: s.type,
          chain: s.chain,
          index: i,
          address: addressFor(child.pubkey, s.type),
          scriptHash: electrumScriptHash(scriptPubKeyFor(child.pubkey, s.type)),
        })
      }
    }
    if (batch.length === 0) break

    const stats = await resolve(batch, opts?.signal)
    if (stats.length !== batch.length) {
      throw new Error('Balance resolver returned a mismatched result count')
    }

    for (let i = 0; i < batch.length; i++) {
      const t = batch[i]
      const s = stats[i]
      const state = states.find((x) => x.type === t.type && x.chain === t.chain)!
      state.derived = Math.max(state.derived, t.index + 1)
      if (!s.used) continue
      state.highestUsed = Math.max(state.highestUsed, t.index)
      satsConfirmed += s.satsConfirmed
      satsUnconfirmed += s.satsUnconfirmed
      txCount += s.txCount
    }

    addressesScanned += batch.length
    opts?.onProgress?.(addressesScanned)
  }

  return {
    btc: (satsConfirmed + satsUnconfirmed) / SATS_PER_BTC,
    satsConfirmed,
    satsUnconfirmed,
    txCount,
    addressesScanned,
  }
}
