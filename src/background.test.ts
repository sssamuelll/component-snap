import { beforeEach, describe, expect, it, vi } from 'vitest'

const stores = vi.hoisted(() => {
  let sessionBacking = new Map<string, unknown>()
  let localBacking = new Map<string, unknown>()

  const makeArea = (getBacking: () => Map<string, unknown>) => ({
    get: async (keys: string | string[] | null) => {
      const backing = getBacking()
      const keyList = Array.isArray(keys) ? keys : keys ? [keys] : Array.from(backing.keys())
      const result: Record<string, unknown> = {}
      for (const key of keyList) {
        if (backing.has(key)) result[key] = backing.get(key)
      }
      return result
    },
    set: async (items: Record<string, unknown>) => {
      const backing = getBacking()
      for (const [key, value] of Object.entries(items)) {
        backing.set(key, value)
      }
    },
    clear: async () => {
      getBacking().clear()
    },
  })

  const fakeChrome = {
    runtime: {
      onInstalled: { addListener: () => {} },
      onMessage: { addListener: () => {} },
    },
    storage: {
      session: makeArea(() => sessionBacking),
      local: makeArea(() => localBacking),
    },
  }

  ;(globalThis as unknown as { chrome: unknown }).chrome = fakeChrome

  return {
    session: {
      reset() {
        sessionBacking = new Map()
      },
      swap(next: Map<string, unknown>) {
        sessionBacking = next
      },
      snapshot() {
        return new Map(sessionBacking)
      },
    },
    local: {
      reset() {
        localBacking = new Map()
      },
    },
  }
})

const session = stores.session

import { captureScreenshotDataUrl, popActiveRequest, registerActiveRequest, type ClipRect } from './background'

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

describe('ELEMENT_SELECTED screenshot sourcing', () => {
  const clipRect: ClipRect = { x: 10, y: 20, width: 100, height: 50, dpr: 2 }

  const makeBundle = (overrides: { clipDataUrl?: string; fullPageDataUrl?: string }) => ({
    version: '0' as const,
    captureId: 'cap-1',
    createdAt: '2026-05-20T00:00:00.000Z',
    backend: 'cdp' as const,
    seed: {},
    screenshot: overrides,
  })

  it('uses CDP clipDataUrl and does not call captureVisibleTab when available', async () => {
    const captureVisibleTab = vi.fn<() => Promise<string>>()
    const cropDataUrl = vi.fn<(dataUrl: string, rect: ClipRect) => Promise<string | null>>()

    const result = await captureScreenshotDataUrl(
      makeBundle({ clipDataUrl: 'data:image/png;base64,<cdp>', fullPageDataUrl: 'data:image/png;base64,<full>' }),
      clipRect,
      captureVisibleTab,
      cropDataUrl,
    )

    expect(result).toEqual({ dataUrl: 'data:image/png;base64,<cdp>', source: 'cdp-clip' })
    expect(captureVisibleTab).not.toHaveBeenCalled()
    expect(cropDataUrl).not.toHaveBeenCalled()
  })

  it('falls back to captureVisibleTab + crop when cdpCapture is undefined', async () => {
    const captureVisibleTab = vi.fn<() => Promise<string>>().mockResolvedValue('data:image/png;base64,<tab>')
    const cropDataUrl = vi
      .fn<(dataUrl: string, rect: ClipRect) => Promise<string | null>>()
      .mockResolvedValue('data:image/png;base64,<crop>')

    const result = await captureScreenshotDataUrl(undefined, clipRect, captureVisibleTab, cropDataUrl)

    expect(result).toEqual({ dataUrl: 'data:image/png;base64,<crop>', source: 'tab-crop' })
    expect(captureVisibleTab).toHaveBeenCalledOnce()
    expect(cropDataUrl).toHaveBeenCalledWith('data:image/png;base64,<tab>', clipRect)
  })

  it('falls back to captureVisibleTab when CDP returned fullPageDataUrl but no clipDataUrl', async () => {
    const captureVisibleTab = vi.fn<() => Promise<string>>().mockResolvedValue('data:image/png;base64,<tab>')
    const cropDataUrl = vi
      .fn<(dataUrl: string, rect: ClipRect) => Promise<string | null>>()
      .mockResolvedValue('data:image/png;base64,<crop>')

    const result = await captureScreenshotDataUrl(
      makeBundle({ fullPageDataUrl: 'data:image/png;base64,<full>' }),
      clipRect,
      captureVisibleTab,
      cropDataUrl,
    )

    expect(result).toEqual({ dataUrl: 'data:image/png;base64,<crop>', source: 'tab-crop' })
    expect(captureVisibleTab).toHaveBeenCalledOnce()
    expect(cropDataUrl).toHaveBeenCalledOnce()
  })

  it('returns source: none without throwing when both CDP and tab fallback fail', async () => {
    const captureVisibleTab = vi.fn<() => Promise<string>>().mockRejectedValue(new Error('inactive tab'))
    const cropDataUrl = vi.fn<(dataUrl: string, rect: ClipRect) => Promise<string | null>>()

    const result = await captureScreenshotDataUrl(undefined, clipRect, captureVisibleTab, cropDataUrl)

    expect(result).toEqual({ dataUrl: undefined, source: 'none' })
    expect(captureVisibleTab).toHaveBeenCalledOnce()
    expect(cropDataUrl).not.toHaveBeenCalled()
  })

  it('returns source: none when cropDataUrl returns null (zero-px clip)', async () => {
    const captureVisibleTab = vi.fn<() => Promise<string>>().mockResolvedValue('data:image/png;base64,<tab>')
    const cropDataUrl = vi.fn<(dataUrl: string, rect: ClipRect) => Promise<string | null>>().mockResolvedValue(null)

    const result = await captureScreenshotDataUrl(undefined, clipRect, captureVisibleTab, cropDataUrl)

    expect(result).toEqual({ dataUrl: undefined, source: 'none' })
  })
})

describe('save-snap storage write preserves unrelated keys', () => {
  beforeEach(() => {
    stores.local.reset()
  })

  // Regression for #31: `chrome.storage.local.clear()` used to run before
  // `set({ lastSelection })`, wiping any other state living in local storage.
  // The save-snap path now writes lastSelection as a plain upsert; other
  // keys (settings, history, baselines, flags) must survive.
  it('writing lastSelection does not wipe unrelated keys like userSettings', async () => {
    await chrome.storage.local.set({ userSettings: { theme: 'dark' } })

    // Mirror the production save-snap pattern from background.ts: a plain
    // upsert on `lastSelection`, with no surrounding `clear()`.
    await chrome.storage.local.set({
      lastSelection: {
        snapFolder: 'component_snap/2026-05-20_div',
        requestId: 'req-xyz',
        snappedAt: '2026-05-20T00:00:00.000Z',
      },
    })

    const after = await chrome.storage.local.get(['userSettings', 'lastSelection'])
    expect(after.userSettings).toEqual({ theme: 'dark' })
    expect(after.lastSelection).toMatchObject({
      snapFolder: 'component_snap/2026-05-20_div',
      requestId: 'req-xyz',
    })
  })
})
