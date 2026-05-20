import { describe, expect, it } from 'vitest'
import {
  captureKeyframeRules,
  parseKeyframeRulesFromStylesheet,
  resolveKeyframes,
  type ParsedKeyframeRule,
} from './cssKeyframesCapture'
import { normalizeMatchedStyleGraph } from './cssCaptureNormalization'
import type { CDPClient } from './client'

const makeClient = (responses: Record<string, { text?: string } | Error>): CDPClient => {
  return {
    send: async (method: string, params?: Record<string, unknown>) => {
      if (method !== 'CSS.getStyleSheetText') throw new Error(`unexpected method: ${method}`)
      const id = String(params?.styleSheetId)
      const result = responses[id]
      if (!result) throw new Error(`unknown stylesheet: ${id}`)
      if (result instanceof Error) throw result
      return result
    },
  } as unknown as CDPClient
}

describe('parseKeyframeRulesFromStylesheet', () => {
  it('parses a simple @keyframes block with balanced nested braces', () => {
    const text = '@keyframes spin { from { opacity: 0 } to { opacity: 1 } }'
    const rules = parseKeyframeRulesFromStylesheet(text)
    expect(rules).toHaveLength(1)
    expect(rules[0]?.name).toBe('spin')
    expect(rules[0]?.isVendorPrefixed).toBe(false)
    expect(rules[0]?.cssText).toBe('@keyframes spin { from { opacity: 0 } to { opacity: 1 } }')
    // Sanity-check brace balance.
    const open = (rules[0]?.cssText.match(/\{/g) || []).length
    const close = (rules[0]?.cssText.match(/\}/g) || []).length
    expect(open).toBe(close)
  })

  it('normalizes @-webkit-keyframes to a plain @keyframes block', () => {
    const text = '@-webkit-keyframes pulse { 0% { transform: scale(1) } 100% { transform: scale(1.2) } }'
    const rules = parseKeyframeRulesFromStylesheet(text)
    expect(rules).toHaveLength(1)
    expect(rules[0]?.name).toBe('pulse')
    expect(rules[0]?.isVendorPrefixed).toBe(true)
    expect(rules[0]?.cssText.startsWith('@keyframes pulse {')).toBe(true)
    expect(rules[0]?.cssText.includes('@-webkit-keyframes')).toBe(false)
  })

  it('does not crash on stray { inside comments or string values', () => {
    const text =
      '@keyframes fancy { /* { decoy } */ 0% { content: "{ not a block" } 100% { content: \'\\{ escaped\' } }'
    const rules = parseKeyframeRulesFromStylesheet(text)
    expect(rules).toHaveLength(1)
    expect(rules[0]?.name).toBe('fancy')
    expect(rules[0]?.cssText.includes('/* { decoy } */')).toBe(true)
    expect(rules[0]?.cssText.includes('"{ not a block"')).toBe(true)
  })

  it('extracts multiple sequential @keyframes blocks from one stylesheet', () => {
    const text =
      '@keyframes spin { from { x: 0 } to { x: 1 } } .other { color: red } @keyframes fade { 0% { opacity: 0 } 100% { opacity: 1 } }'
    const rules = parseKeyframeRulesFromStylesheet(text)
    expect(rules.map((rule) => rule.name)).toEqual(['spin', 'fade'])
  })
})

describe('resolveKeyframes', () => {
  it('filters to only referenced animation names and emits an undefined warning for missing ones', () => {
    const parsed: ParsedKeyframeRule[] = [
      { name: 'foo', cssText: '@keyframes foo { 0% { opacity: 0 } }', isVendorPrefixed: false },
    ]
    const warnings: string[] = []
    const resolved = resolveKeyframes(['foo', 'bar'], parsed, warnings)
    expect(resolved).toEqual([{ name: 'foo', cssText: '@keyframes foo { 0% { opacity: 0 } }' }])
    expect(warnings).toContain('keyframes-name-undefined:bar')
  })

  it('deduplicates same-named keyframes preferring the non-prefixed definition', () => {
    const parsed: ParsedKeyframeRule[] = [
      { name: 'spin', cssText: '@keyframes spin { from { transform: rotate(0) } }', isVendorPrefixed: true },
      { name: 'spin', cssText: '@keyframes spin { from { transform: rotate(0deg) } }', isVendorPrefixed: false },
    ]
    const warnings: string[] = []
    const resolved = resolveKeyframes(['spin'], parsed, warnings)
    expect(resolved).toHaveLength(1)
    expect(resolved[0]?.cssText.includes('rotate(0deg)')).toBe(true)
  })

  it('prefers the last definition when prefix status is equal', () => {
    const parsed: ParsedKeyframeRule[] = [
      { name: 'spin', cssText: '@keyframes spin { from { x: 1 } }', isVendorPrefixed: false },
      { name: 'spin', cssText: '@keyframes spin { from { x: 2 } }', isVendorPrefixed: false },
    ]
    const warnings: string[] = []
    const resolved = resolveKeyframes(['spin'], parsed, warnings)
    expect(resolved[0]?.cssText.includes('x: 2')).toBe(true)
  })
})

describe('captureKeyframeRules', () => {
  it('returns no rules when there are no matched stylesheet ids', async () => {
    const client = makeClient({})
    const warnings: string[] = []
    const rules = await captureKeyframeRules(client, { matchedCSSRules: [] }, warnings)
    expect(rules).toEqual([])
    expect(warnings).toEqual([])
  })

  it('fetches each unique stylesheet once and parses its @keyframes blocks', async () => {
    const client = makeClient({
      'sheet-1': { text: '@keyframes spin { from { x: 0 } to { x: 1 } }' },
      'sheet-2': { text: '@-webkit-keyframes fade { from { opacity: 0 } }' },
    })
    const warnings: string[] = []
    const rules = await captureKeyframeRules(
      client,
      {
        matchedCSSRules: [
          { rule: { style: { styleSheetId: 'sheet-1' } } },
          { rule: { style: { styleSheetId: 'sheet-1' } } },
          { rule: { styleSheetId: 'sheet-2' } },
        ],
      },
      warnings,
    )
    expect(rules.map((rule) => rule.name).sort()).toEqual(['fade', 'spin'])
    expect(warnings).toEqual([])
  })

  it('emits a warning and continues when a stylesheet text fetch fails', async () => {
    const client = makeClient({
      'sheet-bad': new Error('stylesheet gone'),
      'sheet-good': { text: '@keyframes spin { from { x: 0 } to { x: 1 } }' },
    })
    const warnings: string[] = []
    const rules = await captureKeyframeRules(
      client,
      {
        matchedCSSRules: [
          { rule: { styleSheetId: 'sheet-bad' } },
          { rule: { styleSheetId: 'sheet-good' } },
        ],
      },
      warnings,
    )
    expect(rules.map((rule) => rule.name)).toEqual(['spin'])
    expect(warnings).toContain('keyframes-stylesheet-text-unavailable:sheet-bad')
  })
})

describe('normalizeMatchedStyleGraph with parsed keyframe rules', () => {
  it('attaches the full cssText for referenced animation names and warns about undefined ones', () => {
    const graph = normalizeMatchedStyleGraph({
      target: { nodeId: 1, selector: '.cta' },
      matched: {
        matchedCSSRules: [
          {
            rule: {
              origin: 'regular',
              styleSheetId: 'sheet-1',
              sourceURL: 'https://example.com/app.css',
              selectorList: { text: '.cta' },
              style: {
                cssProperties: [{ name: 'animation-name', value: 'foo, bar' }],
              },
            },
          },
        ],
      },
      computed: { computedStyle: [{ name: 'display', value: 'block' }] },
      inline: { inlineStyle: { cssProperties: [] } },
      keyframeRules: [
        { name: 'foo', cssText: '@keyframes foo { 0% { opacity: 0 } 100% { opacity: 1 } }', isVendorPrefixed: false },
      ],
    })

    expect(graph.keyframes).toEqual([
      { name: 'foo', cssText: '@keyframes foo { 0% { opacity: 0 } 100% { opacity: 1 } }' },
    ])
    expect(graph.diagnostics?.warnings).toContain('keyframes-name-undefined:bar')
    expect(graph.diagnostics?.keyframeCount).toBe(1)
  })
})
