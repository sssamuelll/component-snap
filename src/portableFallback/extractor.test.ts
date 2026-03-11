import { describe, expect, it } from 'vitest'
import { buildPortableFallbackComponentJs, buildPortableFallbackExtractionDiagnostics, type PortableFallbackExtractionStats } from './extractor'

const baseStats = (): PortableFallbackExtractionStats => ({
  nodeCount: 12,
  shadowHostCount: 0,
  removedAttributeCount: 0,
  referencedSymbolCount: 0,
  pseudoStateRuleCount: 2,
  pseudoElementRuleCount: 0,
  keyframeRuleCount: 1,
  inlinedAssetRequestCount: 0,
  inlinedAssetFailureCount: 0,
})

describe('buildPortableFallbackComponentJs', () => {
  it('targets the exported root selector passed by the caller', () => {
    const js = buildPortableFallbackComponentJs('[data-csnap-root="true"]')
    expect(js).toContain('const rootSelector = "[data-csnap-root=\\"true\\"]";')
  })
})

describe('buildPortableFallbackExtractionDiagnostics', () => {
  it('always marks extraction as portable fallback and applies base penalty', () => {
    const diagnostics = buildPortableFallbackExtractionDiagnostics(baseStats())

    expect(diagnostics.tier).toBe('portable-fallback')
    expect(diagnostics.used).toBe(true)
    expect(diagnostics.confidencePenalty).toBeGreaterThan(0)
    expect(diagnostics.confidence).toBeLessThan(1)
    expect(diagnostics.warnings).toContain('portable-fallback-extractor-used')
    expect(diagnostics.warnings).toContain('portable-single-folder-export-is-lower-tier')
    expect(diagnostics.warnings).toContain('portable-fallback-is-not-replay-derived')
  })

  it('adds explicit warnings and stronger penalties for degraded fallback signals', () => {
    const diagnostics = buildPortableFallbackExtractionDiagnostics({
      ...baseStats(),
      nodeCount: 260,
      shadowHostCount: 3,
      removedAttributeCount: 24,
      pseudoStateRuleCount: 0,
      keyframeRuleCount: 0,
      inlinedAssetFailureCount: 2,
    })

    expect(diagnostics.warnings).toContain('portable-fallback-shadow-dom-flattened:3')
    expect(diagnostics.warnings).toContain('portable-fallback-attributes-sanitized:24')
    expect(diagnostics.warnings).toContain('portable-fallback-asset-inline-failures:2')
    expect(diagnostics.warnings).toContain('portable-fallback-no-pseudo-state-rules-captured')
    expect(diagnostics.warnings).toContain('portable-fallback-no-keyframes-captured')
    expect(diagnostics.warnings).toContain('portable-fallback-large-subtree:260')
    expect(diagnostics.confidencePenalty).toBeGreaterThan(0.5)
    expect(diagnostics.confidence).toBeLessThan(0.5)
  })
})
