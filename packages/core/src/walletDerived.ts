// BIP32 xpub address derivation + mempool.space balance scan.
//
// Why this exists: Trezor's public Blockbook blocks all datacenter/cloud IP
// ranges (Vercel serverless, Vercel Edge/Cloudflare) with a 403 regardless of
// User-Agent. mempool.space's address API has no such restriction (CORS *,
// works from any IP), but it only accepts individual addresses — so we derive
// them ourselves using BIP32 non-hardened child key derivation.
//
// Works server-side and client-side (pure JS, no Node.js-only APIs).

import { secp256k1 } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha256'
import { ripemd160 } from '@noble/hashes/ripemd160'
import { hmac } from '@noble/hashes/hmac'
import { sha512 } from '@noble/hashes/sha512'
import bs58check from 'bs58check'
import { bech32 } from 'bech32'

// Shape shared with the web fallback fetcher (apps/web/lib/wallet.ts re-imports this).
export type XpubBalance = {
  btc: number
  satsConfirmed: number
  satsUnconfirmed: number
  txCount: number
  addressesScanned: number
}

// ─── Crypto primitives ────────────────────────────────────────────────────────

function bytesToHex(b: Uint8Array): string {
  return Array.from(b)
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('')
}

function hash160(data: Uint8Array): Uint8Array {
  return ripemd160(sha256(data))
}

// ─── BIP32 xpub parsing ───────────────────────────────────────────────────────

// bs58check.decode strips the 4-byte checksum. The remaining 78-byte payload:
// [0-3]   version (4 bytes)
// [4]     depth
// [5-8]   fingerprint
// [9-12]  child index
// [13-44] chain code (32 bytes)
// [45-77] compressed public key (33 bytes)
function parseXpub(key: string): { pubkey: Uint8Array; chainCode: Uint8Array } {
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
function deriveChild(
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

// ─── Address generation ───────────────────────────────────────────────────────

type ScriptType = 'p2pkh' | 'p2shP2wpkh' | 'p2wpkh'

// P2PKH (legacy): 1...  (mainnet 0x00 prefix)
function p2pkh(pubkey: Uint8Array): string {
  const h = hash160(pubkey)
  const payload = new Uint8Array(21)
  payload[0] = 0x00
  payload.set(h, 1)
  return bs58check.encode(payload)
}

// P2SH-P2WPKH (wrapped segwit): 3...  (mainnet 0x05 prefix)
function p2shP2wpkh(pubkey: Uint8Array): string {
  const h = hash160(pubkey)
  const witnessScript = new Uint8Array(22)
  witnessScript[0] = 0x00 // OP_0
  witnessScript[1] = 0x14 // OP_PUSHBYTES_20
  witnessScript.set(h, 2)
  const scriptHash = hash160(witnessScript)
  const payload = new Uint8Array(21)
  payload[0] = 0x05
  payload.set(scriptHash, 1)
  return bs58check.encode(payload)
}

// P2WPKH (native segwit): bc1q...  (bech32, witness version 0)
function p2wpkh(pubkey: Uint8Array): string {
  const h = hash160(pubkey)
  const words = bech32.toWords(h)
  return bech32.encode('bc', [0, ...words])
}

function makeAddress(pubkey: Uint8Array, type: ScriptType): string {
  switch (type) {
    case 'p2pkh':
      return p2pkh(pubkey)
    case 'p2shP2wpkh':
      return p2shP2wpkh(pubkey)
    case 'p2wpkh':
      return p2wpkh(pubkey)
  }
}

// Map xpub key prefix to the script type(s) to scan.
// zpub/Zpub → native segwit only; ypub/Ypub → wrapped segwit only;
// xpub (ambiguous — e.g. Ledger exports xpub for all account types) → all three.
function scriptTypesFor(key: string): ScriptType[] {
  if (key.startsWith('zpub') || key.startsWith('Zpub')) return ['p2wpkh']
  if (key.startsWith('ypub') || key.startsWith('Ypub')) return ['p2shP2wpkh']
  return ['p2pkh', 'p2shP2wpkh', 'p2wpkh']
}

// ─── mempool.space address balance fetch ──────────────────────────────────────

import { coreFetch } from './transport'

export const DEFAULT_MEMPOOL_BASE = 'https://mempool.space/api'
let mempoolBase = DEFAULT_MEMPOOL_BASE

// Point scans at a user-chosen Esplora/mempool instance (own node). Pass a
// falsy value to reset to mempool.space.
export function setMempoolEndpoint(base?: string | null): void {
  mempoolBase = (base || DEFAULT_MEMPOOL_BASE).replace(/\/+$/, '')
}
const ADDR_TIMEOUT_MS = 12_000

type MempoolAddrStats = {
  chain_stats: { funded_txo_sum: number; spent_txo_sum: number; tx_count: number }
  mempool_stats: { funded_txo_sum: number; spent_txo_sum: number; tx_count: number }
}

async function fetchAddr(address: string, signal?: AbortSignal): Promise<MempoolAddrStats | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ADDR_TIMEOUT_MS)
  const merged = signal
    ? (() => {
        signal.addEventListener('abort', () => controller.abort(), { once: true })
        return controller.signal
      })()
    : controller.signal
  try {
    const res = await coreFetch(`${mempoolBase}/address/${address}`, { signal: merged })
    if (!res.ok) return null // treat any HTTP error as "empty" for gap counting
    return res.json() as Promise<MempoolAddrStats>
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

// ─── Gap-limit chain scan ─────────────────────────────────────────────────────

const GAP_LIMIT = 20
const BATCH = 5 // parallel address fetches per round

type ChainResult = { satsConfirmed: number; satsUnconfirmed: number; txCount: number }

async function scanChain(
  parsed: { pubkey: Uint8Array; chainCode: Uint8Array },
  chain: 0 | 1,
  type: ScriptType,
  signal?: AbortSignal,
): Promise<ChainResult> {
  // Derive the chain-level key: xpub/{chain}
  const chainNode = deriveChild(parsed.pubkey, parsed.chainCode, chain)

  let satsConfirmed = 0
  let satsUnconfirmed = 0
  let txCount = 0
  let gap = 0
  let idx = 0

  while (gap < GAP_LIMIT) {
    // Derive a batch of address-level keys and their addresses
    const addresses: string[] = []
    for (let i = 0; i < BATCH; i++) {
      const child = deriveChild(chainNode.pubkey, chainNode.chainCode, idx++)
      addresses.push(makeAddress(child.pubkey, type))
    }

    const stats = await Promise.all(addresses.map((a) => fetchAddr(a, signal)))

    for (const s of stats) {
      const used = s !== null && (s.chain_stats.tx_count > 0 || s.mempool_stats.tx_count > 0)
      if (!used) {
        gap++
      } else {
        gap = 0
        satsConfirmed += s!.chain_stats.funded_txo_sum - s!.chain_stats.spent_txo_sum
        satsUnconfirmed += s!.mempool_stats.funded_txo_sum - s!.mempool_stats.spent_txo_sum
        txCount += s!.chain_stats.tx_count + s!.mempool_stats.tx_count
      }
      if (gap >= GAP_LIMIT) break
    }
  }

  return { satsConfirmed, satsUnconfirmed, txCount }
}

// ─── Public API ───────────────────────────────────────────────────────────────

const SATS_PER_BTC = 1e8

export async function fetchXpubBalanceDerived(xpub: string, signal?: AbortSignal): Promise<XpubBalance> {
  const parsed = parseXpub(xpub)
  const types = scriptTypesFor(xpub)

  // Fan out: scan all (scriptType × chain) pairs in parallel
  const scans = types.flatMap((type) =>
    ([0, 1] as const).map((chain) => scanChain(parsed, chain, type, signal)),
  )
  const results = await Promise.all(scans)

  let satsConfirmed = 0
  let satsUnconfirmed = 0
  let txCount = 0
  for (const r of results) {
    satsConfirmed += r.satsConfirmed
    satsUnconfirmed += r.satsUnconfirmed
    txCount += r.txCount
  }

  return {
    btc: (satsConfirmed + satsUnconfirmed) / SATS_PER_BTC,
    satsConfirmed,
    satsUnconfirmed,
    txCount,
    addressesScanned: 0,
  }
}
