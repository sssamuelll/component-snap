import { describe, expect, it } from 'vitest'
import { captureCSSProvenanceGraph, normalizeMatchedStyleGraph } from './cssCapture'
import type { CDPClient } from './client'

describe('normalizeMatchedStyleGraph', () => {
  it('normalizes selector lists, stylesheet metadata, origins, and provenance diagnostics', () => {
    const graph = normalizeMatchedStyleGraph({
      target: { nodeId: 11, selector: '.cta' },
      matched: {
        matchedCSSRules: [
          {
            rule: {
              origin: 'regular',
              styleSheetId: 'sheet-1',
              sourceURL: ' https://example.com/app.css ',
              selectorList: { selectors: [{ text: '  .cta  , .cta  ' }, { text: '.cta-primary' }] },
              style: {
                range: { startLine: 9, startColumn: 4 },
                cssProperties: [
                  { name: 'color', value: 'red', important: true },
                  { name: '--button-bg', value: '#f00' },
                  { name: 'animation', value: '250ms ease-in pulse' },
                  { name: 'background', value: 'var(--button-bg)' },
                ],
              },
            },
          },
          {
            rule: {
              styleSheetId: 'inspector-inline-sheet-for-test',
              selectorList: { text: '  .cta-inline  ' },
              style: { cssProperties: [{ name: 'color', value: 'blue' }] },
            },
          },
        ],
      },
      computed: {
        computedStyle: [
          { name: 'display', value: 'block' },
          { name: '--button-bg', value: '#f00' },
          { name: 'animation-name', value: 'fade-in' },
        ],
      },
      inline: {
        inlineStyle: {
          cssProperties: [{ name: 'animation-name', value: 'pulse' }, { name: 'color', value: 'var(--button-bg)' }],
        },
      },
    })

    expect(graph.target.nodeId).toBe(11)
    expect(graph.matchedRules).toHaveLength(2)
    expect(graph.matchedRules[0]?.selectorList).toEqual(['.cta', '.cta-primary'])
    expect(graph.matchedRules[0]?.stylesheet).toEqual({
      styleSheetId: 'sheet-1',
      sourceURL: 'https://example.com/app.css',
      isInline: false,
      startLine: 9,
      startColumn: 4,
    })
    expect(graph.matchedRules[1]?.origin).toBe('inline')
    expect(graph.matchedRules[0]?.declarations.some((declaration) => declaration.name === '--button-bg')).toBe(true)
    expect(graph.keyframes).toEqual(['pulse', 'fade-in'])
    expect(graph.customProperties?.some((entry) => entry.name === '--button-bg')).toBe(true)
    expect(graph.customProperties?.some((entry) => entry.source === 'reference:inline')).toBe(true)
    expect(graph.diagnostics?.warnings).toContain('keyframes-derived-heuristically')
    expect(graph.diagnostics?.warnings).toContain('keyframes-from-computed')
    expect(graph.diagnostics?.warnings).not.toContain('stylesheet-source-missing')
    expect(graph.diagnostics?.ruleCount).toBe(2)
    expect(graph.diagnostics?.matchedRuleWithOriginCount).toBe(2)
    expect(graph.diagnostics?.keyframeCount).toBe(2)
  })

  it('adds empty-state diagnostics when no style data is present', () => {
    const graph = normalizeMatchedStyleGraph({
      target: { nodeId: 99 },
      matched: { matchedCSSRules: [] },
      computed: { computedStyle: [] },
      inline: { inlineStyle: { cssProperties: [] } },
    })

    expect(graph.matchedRules).toHaveLength(0)
    expect(graph.diagnostics?.warnings).toContain('matched-rules-empty')
    expect(graph.diagnostics?.warnings).toContain('computed-style-empty')
    expect(graph.diagnostics?.warnings).toContain('inline-style-empty')
  })

  it('marks computed-only fallback and missing selector/origin diagnostics', () => {
    const graph = normalizeMatchedStyleGraph({
      target: { nodeId: 25 },
      matched: {
        matchedCSSRules: [
          {
            rule: {
              styleSheetId: 'sheet-2',
              selectorList: { text: '   ' },
              style: {
                cssProperties: [{ name: 'color', value: 'black' }],
              },
            },
          },
        ],
      },
      computed: {
        computedStyle: [{ name: 'display', value: 'inline-block' }],
      },
      inline: { inlineStyle: { cssProperties: [] } },
    })

    expect(graph.diagnostics?.warnings).toContain('selector-list-empty')
    expect(graph.diagnostics?.warnings).toContain('rule-origin-missing')
    expect(graph.diagnostics?.warnings).toContain('stylesheet-source-missing')
    expect(graph.diagnostics?.warnings).toContain('stylesheet-metadata-incomplete')
    expect(graph.diagnostics?.matchedRuleWithoutSelectorCount).toBe(1)
    expect(graph.diagnostics?.matchedRuleWithoutOriginCount).toBe(1)
    expect(graph.diagnostics?.matchedRuleWithIncompleteStylesheetMetadataCount).toBe(1)
  })

  it('marks provenance degradation when matched rules are unavailable but computed exists', () => {
    const graph = normalizeMatchedStyleGraph({
      target: { nodeId: 31 },
      matched: { matchedCSSRules: [] },
      computed: {
        computedStyle: [{ name: 'display', value: 'block' }, { name: 'animation', value: '200ms linear spin' }],
      },
      inline: { inlineStyle: { cssProperties: [] } },
    })

    expect(graph.diagnostics?.warnings).toContain('matched-rules-empty')
    expect(graph.diagnostics?.warnings).toContain('provenance-degraded-computed-only')
    expect(graph.keyframes).toEqual(['spin'])
  })

  it('preserves user-agent origin in matched rules', () => {
    const graph = normalizeMatchedStyleGraph({
      target: { nodeId: 77, selector: 'input' },
      matched: {
        matchedCSSRules: [
          {
            rule: {
              origin: 'user-agent',
              selectorList: { text: 'input[type="search"]' },
              style: { cssProperties: [{ name: 'appearance', value: 'auto' }] },
            },
          },
        ],
      },
      computed: { computedStyle: [{ name: 'display', value: 'inline-block' }] },
      inline: { inlineStyle: { cssProperties: [] } },
    })

    expect(graph.matchedRules[0]?.origin).toBe('user-agent')
    expect(graph.diagnostics?.matchedRuleUserAgentCount).toBe(1)
    expect(graph.diagnostics?.warnings).not.toContain('rule-origin-missing')
  })

  it('handles mixed inline + regular + computed provenance with keyframes and custom properties', () => {
    const graph = normalizeMatchedStyleGraph({
      target: { nodeId: 55, selector: '.chip' },
      matched: {
        matchedCSSRules: [
          {
            rule: {
              origin: 'regular',
              styleSheetId: 'sheet-10',
              sourceURL: 'https://example.com/chip.css',
              selectorList: { text: '.chip' },
              style: {
                cssProperties: [
                  { name: '--chip-bg', value: '#ffd100' },
                  { name: 'background-color', value: 'var(--chip-bg)' },
                  { name: 'animation', value: '180ms ease-in chip-pop' },
                ],
              },
            },
          },
        ],
      },
      computed: {
        computedStyle: [
          { name: '--chip-bg', value: '#ffd100' },
          { name: 'animation-name', value: 'chip-fade' },
          { name: 'box-shadow', value: '0 0 0 2px var(--chip-outline)' },
        ],
      },
      inline: {
        inlineStyle: {
          cssProperties: [
            { name: '--chip-outline', value: 'rgba(0, 0, 0, 0.2)' },
            { name: 'animation-name', value: 'chip-pop' },
          ],
        },
      },
    })

    expect(graph.keyframes).toEqual(['chip-pop', 'chip-fade'])
    expect(graph.customProperties?.some((entry) => entry.name === '--chip-bg' && entry.source === 'rule:.chip')).toBe(true)
    expect(graph.customProperties?.some((entry) => entry.name === '--chip-outline' && entry.source === 'inline')).toBe(true)
    expect(graph.diagnostics?.customPropertyReferenceCount).toBe(2)
    expect(graph.diagnostics?.warnings).toContain('keyframes-derived-heuristically')
    expect(graph.diagnostics?.warnings).toContain('keyframes-from-computed')
  })

  it('flags custom property references that have no direct declaration or resolved computed value', () => {
    const graph = normalizeMatchedStyleGraph({
      target: { nodeId: 105, selector: '.card' },
      matched: {
        matchedCSSRules: [
          {
            rule: {
              origin: 'regular',
              selectorList: { text: '.card' },
              style: {
                cssProperties: [{ name: 'color', value: 'var(--missing-color)' }],
              },
            },
          },
        ],
      },
      computed: {
        computedStyle: [{ name: 'color', value: 'rgb(0, 0, 0)' }],
      },
      inline: { inlineStyle: { cssProperties: [] } },
    })

    expect(graph.customProperties).toContainEqual({
      name: '--missing-color',
      value: '',
      source: 'reference:rule:.card',
    })
    expect(graph.diagnostics?.warnings).toContain('custom-property-reference-only')
    expect(graph.diagnostics?.warnings).toContain('custom-property-reference-unresolved')
    expect(graph.diagnostics?.customPropertyReferenceOnlyCount).toBe(1)
    expect(graph.diagnostics?.unresolvedCustomPropertyReferenceCount).toBe(1)
  })

  it('reports incomplete stylesheet metadata when stylesheet id/url data is partial', () => {
    const graph = normalizeMatchedStyleGraph({
      target: { nodeId: 222, selector: '.meta' },
      matched: {
        matchedCSSRules: [
          {
            rule: {
              origin: 'regular',
              sourceURL: 'https://example.com/only-url.css',
              selectorList: { text: '.meta' },
              style: { cssProperties: [{ name: 'display', value: 'block' }] },
            },
          },
          {
            rule: {
              origin: 'regular',
              styleSheetId: 'sheet-only-id',
              selectorList: { text: '.meta.id' },
              style: { cssProperties: [{ name: 'opacity', value: '0.9' }] },
            },
          },
        ],
      },
      computed: { computedStyle: [{ name: 'display', value: 'block' }] },
      inline: { inlineStyle: { cssProperties: [] } },
    })

    expect(graph.diagnostics?.warnings).toContain('stylesheet-metadata-incomplete')
    expect(graph.diagnostics?.warnings).toContain('stylesheet-source-missing')
    expect(graph.diagnostics?.matchedRuleWithIncompleteStylesheetMetadataCount).toBe(2)
  })
})

describe('captureCSSProvenanceGraph', () => {
  it('fails soft when CSS domain cannot be enabled', async () => {
    const client = {
      send: async () => {
        throw new Error('domain unavailable')
      },
    } as unknown as CDPClient

    const result = await captureCSSProvenanceGraph(client, { nodeId: 12 })
    expect(result.cssGraph).toBeUndefined()
    expect(result.warnings.join(' ')).toContain('css-domain-unavailable')
  })

  it('returns partial graph when some CSS calls fail', async () => {
    const client = {
      send: async (method: string) => {
        if (method === 'CSS.enable') return {}
        if (method === 'CSS.getMatchedStylesForNode') throw new Error('matched failed')
        if (method === 'CSS.getComputedStyleForNode') return { computedStyle: [{ name: 'display', value: 'block' }] }
        if (method === 'CSS.getInlineStylesForNode') return { inlineStyle: { cssProperties: [] } }
        throw new Error(`unexpected method: ${method}`)
      },
    } as unknown as CDPClient

    const result = await captureCSSProvenanceGraph(client, { nodeId: 13 })
    expect(result.cssGraph).toBeDefined()
    expect(result.warnings).toContain('matched-styles-failed')
    expect(result.warnings).toContain('css-capture-partial-failure')
    expect(result.cssGraph?.computed?.[0]).toEqual({ name: 'display', value: 'block' })
  })

  it('returns no graph and explicit no-data warning when all style fetch calls fail', async () => {
    const client = {
      send: async (method: string) => {
        if (method === 'CSS.enable') return {}
        throw new Error(`${method} failed`)
      },
    } as unknown as CDPClient

    const result = await captureCSSProvenanceGraph(client, { nodeId: 44 })
    expect(result.cssGraph).toBeUndefined()
    expect(result.warnings).toContain('matched-styles-failed')
    expect(result.warnings).toContain('computed-style-failed')
    expect(result.warnings).toContain('inline-style-failed')
    expect(result.warnings).toContain('css-capture-no-data')
  })
})
