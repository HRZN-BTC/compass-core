// localStorage provider — browser dev fallback ONLY (running the desktop
// frontend with `next dev` in a plain browser, where Tauri commands don't
// exist). Unencrypted; never ship as a user-facing storage mode. The web app's
// real local-first backend (IndexedDB, encrypted) is Phase B4.

import { buildProvider, migrateExport, toExport, type StorageProvider } from '@compass/core'

const KEY = 'compass-store-dev'

export function createLocalStorageProvider(): StorageProvider {
  return buildProvider({
    kind: 'local-storage',
    async load() {
      const raw = localStorage.getItem(KEY)
      if (!raw) return null
      return migrateExport(JSON.parse(raw))
    },
    persist(data) {
      localStorage.setItem(KEY, JSON.stringify(toExport(data)))
    },
    async eraseBacking() {
      localStorage.removeItem(KEY)
    },
  })
}
