// Encrypted JSON-file provider (Tauri desktop). All crypto happens in Rust —
// the key never enters JS. This side just serializes the store envelope and
// debounces writes so rapid edits coalesce into one disk write.

import { invoke } from '@tauri-apps/api/core'
import { buildProvider, migrateExport, toExport, type CompassData, type StorageProvider } from '@compass/core'

const WRITE_DEBOUNCE_MS = 300

export function createJsonFileProvider(): StorageProvider {
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending: CompassData | null = null

  const flush = () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    if (pending) {
      const json = JSON.stringify(toExport(pending))
      pending = null
      void invoke('store_save', { json }).catch((e) => console.error('store_save failed:', e))
    }
  }

  if (typeof window !== 'undefined') {
    // Flush the debounce window on quit/hide so the last edit is never lost.
    window.addEventListener('beforeunload', flush)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush()
    })
  }

  return buildProvider({
    kind: 'json-file',
    async load() {
      const json = await invoke<string | null>('store_load')
      if (!json) return null
      return migrateExport(JSON.parse(json))
    },
    persist(data) {
      pending = data
      if (timer) clearTimeout(timer)
      timer = setTimeout(flush, WRITE_DEBOUNCE_MS)
    },
    async eraseBacking() {
      pending = null
      if (timer) clearTimeout(timer)
      await invoke('store_wipe')
    },
  })
}
