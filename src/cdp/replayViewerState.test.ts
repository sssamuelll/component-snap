import { describe, expect, it } from 'vitest'
import { buildReplayViewerState } from './replayViewerState'
import type { CaptureSeed, ReplayCapsuleV0 } from './types'

const baseCapsule: ReplayCapsuleV0 = {
  version: '0',
  mode: 'snapshot-first',
  createdAt: '2026-03-09T10:00:00.000Z',
  snapshot: {
    page: {
      url: 'https://example.com',
      title: 'Example',
      viewport: { width: 1200, height: 800 },
      scroll: { x: 0, y: 0 },
      dpr: 2,
      userAgent: 'ua',
      colorScheme: 'light',
      language: 'en',
    },
    screenshot: {},
    domSnapshot: {},
  },
  timeline: { events: [] },
}

const withScreenshot = (screenshot: ReplayCapsuleV0['snapshot']['screenshot']): ReplayCapsuleV0 => ({
  ...baseCapsule,
  snapshot: {
    ...baseCapsule.snapshot,
    screenshot,
  },
})

describe('buildReplayViewerState', () => {
  it('prefers clipDataUrl when available', () => {
    const state = buildReplayViewerState({
      replayCapsule: withScreenshot({
        clipDataUrl: 'data:image/png;base64,clip',
        fullPageDataUrl: 'data:image/png;base64,full',
        clipRect: { x: 8, y: 12, width: 120, height: 60, dpr: 2 },
      }),
      mode: 'fit',
    })

    expect(state.imageSrc).toBe('data:image/png;base64,clip')
    expect(state.imageSource).toBe('clip')
    expect(state.targetRectInImage).toEqual({ x: 0, y: 0, width: 120, height: 60 })
  })

  it('falls back to full screenshot and uses clipRect for crop targeting', () => {
    const state = buildReplayViewerState({
      replayCapsule: withScreenshot({
        fullPageDataUrl: 'data:image/png;base64,full',
        clipRect: { x: 40, y: 22, width: 200, height: 110, dpr: 1 },
      }),
      mode: 'crop',
    })

    expect(state.imageSrc).toBe('data:image/png;base64,full')
    expect(state.imageSource).toBe('full')
    expect(state.cropRect).toEqual({ x: 40, y: 22, width: 200, height: 110 })
    expect(state.screenshotWarnings).toEqual([])
  })

  it('uses seed boundingBox when clipRect is missing', () => {
    const captureSeed: CaptureSeed = {
      requestId: 'req_1',
      pageUrl: 'https://example.com',
      pageTitle: 'Example',
      boundingBox: { x: 5, y: 7, width: 80, height: 45, dpr: 2 },
    }

    const state = buildReplayViewerState({
      replayCapsule: withScreenshot({ fullPageDataUrl: 'data:image/png;base64,full' }),
      mode: 'crop',
      captureSeed,
    })

    expect(state.cropRect).toEqual({ x: 5, y: 7, width: 80, height: 45 })
  })

  it('emits warnings when screenshot data is missing', () => {
    const state = buildReplayViewerState({
      replayCapsule: withScreenshot({}),
      mode: 'spotlight',
    })

    expect(state.imageSource).toBe('none')
    expect(state.screenshotWarnings.join(' ')).toContain('No screenshot available')
  })
})
