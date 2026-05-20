import { beforeEach, describe, expect, it, vi } from 'vitest'

const session = vi.hoisted(() => {
  let backing = new Map<string, unknown>()

  const fakeChrome = {
    runtime: {
      onInstalled: { addListener: () => {} },
      onMessage: { addListener: () => {} },
    },
    storage: {
      session: {
        get: async (keys: string | string[] | null) => {
          const keyList = Array.isArray(keys) ? keys : keys ? [keys] : Array.from(backing.keys())
          const result: Record<string, unknown> = {}
          for (const key of keyList) {
            if (backing.has(key)) result[key] = backing.get(key)
          }
          return result
        },
        set: async (items: Record<string, unknown>) => {
          for (const [key, value] of Object.entries(items)) {
            backing.set(key, value)
          }
        },
      },
    },
  }

  ;(globalThis as unknown as { chrome: unknown }).chrome = fakeChrome

  return {
    reset() {
      backing = new Map()
    },
    swap(next: Map<string, unknown>) {
      backing = next
    },
    snapshot() {
      return new Map(backing)
    },
  }
})

import { popActiveRequest, registerActiveRequest } from './background'

describe('active request persistence (chrome.storage.session)', () => {
  beforeEach(() => {
    session.reset()
  })

  it('round-trips a registered tabId through pop', async () => {
    await registerActiveRequest('req-1', 42)
    expect(await popActiveRequest('req-1')).toBe(42)
  })

  it('returns undefined on a second pop for the same id', async () => {
    await registerActiveRequest('req-1', 42)
    await popActiveRequest('req-1')
    expect(await popActiveRequest('req-1')).toBeUndefined()
  })

  it('returns undefined for an unknown id without throwing', async () => {
    await expect(popActiveRequest('inexistente')).resolves.toBeUndefined()
  })

  it('survives a service worker recycle (storage preserved, module state gone)', async () => {
    // Simulate the post-reclaim state: a previous SW instance registered
    // the request, then got evicted. storage.session is preserved by the
    // browser; the new SW instance has no in-memory record. The old
    // Map-in-module-scope implementation would return undefined here.
    session.swap(new Map([['activeRequests', { 'req-recycle': 99 }]]))
    expect(await popActiveRequest('req-recycle')).toBe(99)
  })
})
