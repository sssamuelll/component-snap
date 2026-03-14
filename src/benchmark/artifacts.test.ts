import { describe, expect, it } from 'vitest'

import {
  buildPortablePreviewDocument,
  buildReplayViewerArtifact,
  dataUrlToBuffer,
  inspectPortableArtifactStructure,
  sanitizeArtifactSegment,
} from './artifacts'
import type { ReplayViewerState } from '../cdp/replayViewerState'

describe('benchmark artifacts helpers', () => {
  it('sanitizes artifact path segments', () => {
    expect(sanitizeArtifactSegment(' Google Search Bar ')).toBe('google-search-bar')
    expect(sanitizeArtifactSegment('***')).toBe('artifact')
  })

  it('decodes base64 data urls', () => {
    const buffer = dataUrlToBuffer('data:text/plain;base64,aGVsbG8=')
    expect(buffer.toString('utf8')).toBe('hello')
  })

  it('builds an inline portable preview document', () => {
    const doc = buildPortablePreviewDocument({
      title: 'Portable Preview',
      html: '<button class="cta">Open</button>',
      css: '.cta { color: red; }',
      js: 'document.body.dataset.ready = "true"',
    })

    expect(doc).toContain('<div id="component-snap-root"><button class="cta">Open</button></div>')
    expect(doc).toContain('<style>.cta { color: red; }</style>')
    expect(doc).toContain('<script type="module">document.body.dataset.ready = "true"</script>')
  })

  it('detects aligned materialized roots in portable artifacts', () => {
    const structure = inspectPortableArtifactStructure({
      html: '<form data-csnap-root="true"><button type="button"></button></form>',
      js: `const rootSelector = '[data-csnap-root="true"]';`,
      expectedRootSelector: '[data-csnap-root="true"]',
    })

    expect(structure.ok).toBe(true)
    expect(structure.warnings).toEqual([])
    expect(structure.evidence).toContain('structure-root-materialized')
    expect(structure.evidence).toContain('structure-bootstrap-root-aligned')
    expect(structure.evidence).toContain('structure-expected-root-present')
  })

  it('flags scene artifacts that preserve primitives without a frame', () => {
    const structure = inspectPortableArtifactStructure({
      html: '<cg-board><piece class="white king"></piece></cg-board>',
      js: 'const rootSelector = "div.puzzle__board.main-board";',
      targetClass: 'render-scene',
    })

    expect(structure.ok).toBe(false)
    expect(structure.warnings).toContain('structure-root-missing')
    expect(structure.warnings).toContain('structure-scene-frame-missing')
  })

  it('builds a replay viewer artifact with metadata', () => {
    const state: ReplayViewerState = {
      mode: 'spotlight',
      imageSrc: 'data:image/png;base64,abc',
      imageSource: 'clip',
      pageTitle: 'Example',
      pageUrl: 'https://example.com',
      createdAt: '2026-03-09T12:00:00.000Z',
      targetRect: { x: 10, y: 20, width: 100, height: 40 },
      targetRectInImage: { x: 0, y: 0, width: 100, height: 40 },
      cropRect: { x: 10, y: 20, width: 100, height: 40 },
      screenshotWarnings: ['warning-a'],
      debug: {
        timelineEventCount: 2,
        missingArtifacts: [],
        mappingStrategy: 'runtime-structural',
        mappingConfidence: 0.9,
      },
    }

    const doc = buildReplayViewerArtifact(state)

    expect(doc).toContain('Replay Viewer Artifact')
    expect(doc).toContain('data:image/png;base64,abc')
    expect(doc).toContain('mappingStrategy=runtime-structural')
    expect(doc).toContain('warnings=warning-a')
  })
})
