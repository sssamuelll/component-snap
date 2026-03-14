import { describe, expect, it } from 'vitest'

import { scoreCaptureFidelity } from '../cdp/fidelityScoring'
import type { CaptureBundleV0 } from '../cdp/types'
import { buildScenarioReport, buildSuiteReport, type BenchmarkSuiteResult } from './reporting'

const buildCapture = (): CaptureBundleV0 => ({
  version: '0',
  captureId: 'cdp_1',
  createdAt: '2026-03-09T12:00:00.000Z',
  backend: 'cdp',
  seed: {
    requestId: 'req_1',
    pageUrl: 'https://example.com',
    pageTitle: 'Example',
    selectedSelector: '.target',
    targetFingerprint: {
      tagName: 'div',
      classList: ['target'],
      attributeHints: [],
      ancestry: [],
      boundingBox: { x: 0, y: 0, width: 160, height: 48 },
    },
  },
  page: {
    url: 'https://example.com',
    title: 'Example',
    viewport: { width: 1200, height: 800 },
    scroll: { x: 0, y: 0 },
    dpr: 2,
  },
  screenshot: {
    clipDataUrl: 'data:image/png;base64,clip',
    clipRect: { x: 0, y: 0, width: 160, height: 48, dpr: 2 },
  },
  domSnapshot: { raw: { documents: [] }, stats: { documents: 1, nodes: 20 } },
  runtimeHints: {},
  cssGraph: {
    target: { nodeId: 1, selector: '.target' },
    inline: { declarations: [{ name: 'display', value: 'block' }] },
    matchedRules: [{ selectorList: ['.target'], declarations: [{ name: 'color', value: '#111' }] }],
    keyframes: [],
    diagnostics: { ruleCount: 1 },
  },
  resourceGraph: {
    nodes: [{ id: 'doc', kind: 'document' }],
    edges: [],
    bundler: { mode: 'light', assets: [] },
  },
  replayCapsule: {
    version: '0',
    mode: 'snapshot-first',
    createdAt: '2026-03-09T12:00:00.000Z',
    snapshot: {
      page: {
        url: 'https://example.com',
        title: 'Example',
        viewport: { width: 1200, height: 800 },
        scroll: { x: 0, y: 0 },
        dpr: 2,
      },
      screenshot: {
        clipDataUrl: 'data:image/png;base64,clip',
        clipRect: { x: 0, y: 0, width: 160, height: 48, dpr: 2 },
      },
      domSnapshot: { raw: { documents: [] }, stats: { documents: 1, nodes: 20 } },
      cssGraph: {
        target: { nodeId: 1, selector: '.target' },
        inline: { declarations: [{ name: 'display', value: 'block' }] },
        matchedRules: [{ selectorList: ['.target'], declarations: [{ name: 'color', value: '#111' }] }],
        keyframes: [],
        diagnostics: { ruleCount: 1 },
      },
      resourceGraph: {
        nodes: [{ id: 'doc', kind: 'document' }],
        edges: [],
        bundler: { mode: 'light', assets: [] },
      },
    },
    timeline: { events: [] },
    diagnostics: { timelineEventCount: 0, warnings: ['replay-capsule-empty-timeline'] },
  },
})

describe('benchmark reporting', () => {
  it('builds a scenario report with fidelity sections and benchmark metadata', () => {
    const scoring = scoreCaptureFidelity({ capture: buildCapture() })
    const report = buildScenarioReport({
      result: {
        scenarioId: 'example',
        title: 'Example scenario',
        status: 'passed',
        url: 'https://example.com',
        selector: '.target',
        originalSelector: '.target > button',
        promotedSelector: '.target',
        promotionReason: 'promotion:visual-bounded-root',
        promotionPath: ['button.cta', 'div.target'],
        exportTier: 'capsule',
        expectedTargetClass: 'semantic-shell',
        expectedTargetSubtype: 'search-like',
        targetClassHint: 'semantic-shell',
        targetSubtypeHint: 'search-like',
        targetClassReasons: ['class-evidence:search-field-present', 'class-evidence:functional-wrapper-present'],
        startedAt: '2026-03-09T12:00:00.000Z',
        completedAt: '2026-03-09T12:01:00.000Z',
        warnings: ['warning-a'],
        notes: ['note-a'],
        replay: {
          artifact: {
            path: 'replay.png',
            pixelDiff: {
              mismatchPixels: 4,
              mismatchRatio: 0.02,
              dimensionsMatch: true,
              comparedDimensions: { width: 160, height: 48 },
              baselineDimensions: { width: 160, height: 48 },
              candidateDimensions: { width: 160, height: 48 },
            },
            structuralWarnings: [],
            structuralEvidence: ['structure-root-materialized'],
          },
        },
        portable: {
          artifact: {
            path: 'portable.png',
            pixelDiff: {
              mismatchPixels: 8,
              mismatchRatio: 0.04,
              dimensionsMatch: true,
              comparedDimensions: { width: 160, height: 48 },
              baselineDimensions: { width: 160, height: 48 },
              candidateDimensions: { width: 160, height: 48 },
            },
            structuralWarnings: ['structure-bootstrap-root-mismatch'],
            structuralEvidence: ['structure-root-materialized'],
            preservationReasons: ['semantic-wrapper-hints-recovered', 'semantic-wrapper-depth-recovered:3'],
          },
        },
      },
      replayScoring: scoring,
      portableScoring: scoring,
      suite: 'component-snap-benchmark',
      version: 'v1',
    })

    expect(report).toContain('Component Snap Benchmark Scenario')
    expect(report).toContain('Replay Fidelity')
    expect(report).toContain('Portable Fidelity')
    expect(report).toContain('Benchmark: component-snap-benchmark:example:replay @ v1')
    expect(report).toContain('Expected target class: semantic-shell')
    expect(report).toContain('Expected target subtype: search-like')
    expect(report).toContain('Target class: semantic-shell')
    expect(report).toContain('Target subtype: search-like')
    expect(report).toContain('Original selector: .target > button')
    expect(report).toContain('Promoted selector: .target')
    expect(report).toContain('Promotion reason: promotion:visual-bounded-root')
    expect(report).toContain('Promotion path: button.cta -> div.target')
    expect(report).toContain('Target class reasons: class-evidence:search-field-present, class-evidence:functional-wrapper-present')
    expect(report).toContain('Portable diff: mismatch=0.040 pixels=8 dimensionsMatch=true')
    expect(report).toContain('Replay structure: warnings=none | evidence=structure-root-materialized | preservation=none')
    expect(report).toContain('Portable structure: warnings=structure-bootstrap-root-mismatch | evidence=structure-root-materialized | preservation=semantic-wrapper-hints-recovered, semantic-wrapper-depth-recovered:3')
  })

  it('builds a compact suite summary', () => {
    const suite: BenchmarkSuiteResult = {
      suite: 'component-snap-benchmark',
      version: 'v1',
      startedAt: '2026-03-09T12:00:00.000Z',
      completedAt: '2026-03-09T12:01:00.000Z',
      outputDir: 'benchmarks/runs/run-1',
      scenarios: [
        {
          scenarioId: 'google-search-bar',
          title: 'Google',
          status: 'passed',
          url: 'https://www.google.com',
          selector: 'textarea[name="q"]',
          originalSelector: 'textarea[name="q"]',
          promotedSelector: 'form[role="search"]',
          promotionReason: 'promotion:search-shell-root',
          promotionPath: ['textarea[name="q"]', 'form[role="search"]'],
          exportTier: 'capsule',
          expectedTargetClass: 'semantic-shell',
          expectedTargetSubtype: 'search-like',
          targetClassHint: 'semantic-shell',
          targetSubtypeHint: 'search-like',
          targetClassReasons: ['class-evidence:search-field-present'],
          startedAt: '2026-03-09T12:00:00.000Z',
          completedAt: '2026-03-09T12:01:00.000Z',
          warnings: ['warning-a'],
          notes: [],
          replay: { score: 0.91 },
          portable: { score: 0.82 },
        },
      ],
    }

    const report = buildSuiteReport(suite)

    expect(report).toContain('Suite: component-snap-benchmark @ v1')
    expect(report).toContain('Results: passed=1 failed=0 skipped=0')
    expect(report).toContain('google-search-bar: passed | selector=textarea[name="q"] | original=textarea[name="q"] | promoted=form[role="search"] | promotion=promotion:search-shell-root | tier=capsule | expectedClass=semantic-shell | expectedSubtype=search-like | class=semantic-shell | subtype=search-like | replay=0.910 | portable=0.820 | warnings=1')
  })
})
