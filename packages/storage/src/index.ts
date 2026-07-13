import type { StorageProvider } from '@compass/core'
import { createJsonFileProvider } from './json'
import { createLocalStorageProvider } from './local'

export { createJsonFileProvider } from './json'
export { createLocalStorageProvider } from './local'

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

// Platform pick: encrypted file inside the Tauri app, localStorage when the
// desktop frontend runs in a plain browser (dev convenience).
export function createDefaultProvider(): StorageProvider {
  return isTauri() ? createJsonFileProvider() : createLocalStorageProvider()
}
