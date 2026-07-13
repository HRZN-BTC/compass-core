// Injectable fetch transport. Core code never assumes an environment: the web
// app keeps the global fetch (and Next's `revalidate` upstream caching); the
// Tauri desktop app injects the plugin-http fetch, which bypasses webview CORS.

export type CoreFetchInit = RequestInit & {
  // Next.js server-side upstream cache hint. Ignored by non-Next transports.
  revalidate?: number
}

export type CoreFetch = (url: string, init?: CoreFetchInit) => Promise<Response>

let impl: CoreFetch = (url, init) => {
  const { revalidate, ...rest } = init ?? {}
  const finalInit =
    revalidate != null
      ? // `next` is a Next.js fetch extension; harmless elsewhere.
        ({ ...rest, next: { revalidate } } as RequestInit)
      : rest
  return fetch(url, finalInit)
}

export const coreFetch: CoreFetch = (url, init) => impl(url, init)

export function setFetchTransport(f: CoreFetch): void {
  impl = f
}
