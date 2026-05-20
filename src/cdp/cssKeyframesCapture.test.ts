import { describe, expect, it } from 'vitest'
import {
  captureKeyframeRules,
  captureKeyframesFromRuntime,
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

  it.each([
    ['@-moz-keyframes', '-moz-'],
    ['@-o-keyframes', '-o-'],
    ['@-ms-keyframes', '-ms-'],
  ])('normalizes %s to a plain @keyframes block (prefix %s)', (header) => {
    const text = `${header} slide { from { left: 0 } to { left: 100% } }`
    const rules = parseKeyframeRulesFromStylesheet(text)
    expect(rules).toHaveLength(1)
    expect(rules[0]?.name).toBe('slide')
    expect(rules[0]?.isVendorPrefixed).toBe(true)
    expect(rules[0]?.cssText.startsWith('@keyframes slide {')).toBe(true)
    expect(rules[0]?.cssText.includes('@-')).toBe(false)
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

type RuntimeEvaluateValueResponse = { result?: { value?: Array<{ name: string; cssText: string }> } }

const makeRuntimeClient = (
  result: { value?: Array<{ name: string; cssText: string }> } | Error,
): CDPClient => {
  return {
    send: async (method: string) => {
      if (method !== 'Runtime.evaluate') throw new Error(`unexpected method: ${method}`)
      if (result instanceof Error) throw result
      return { result } as RuntimeEvaluateValueResponse
    },
  } as unknown as CDPClient
}

describe('captureKeyframesFromRuntime', () => {
  it('returns parsed keyframes from the runtime enumeration payload', async () => {
    const client = makeRuntimeClient({
      value: [
        { name: 'spin', cssText: '@keyframes spin { from { x: 0 } to { x: 1 } }' },
        { name: 'fade', cssText: '@keyframes fade { 0% { opacity: 0 } }' },
      ],
    })
    const warnings: string[] = []
    const rules = await captureKeyframesFromRuntime(client, warnings)
    expect(rules.map((r) => r.name)).toEqual(['spin', 'fade'])
    expect(rules.every((r) => !r.isVendorPrefixed)).toBe(true)
    expect(warnings).toEqual([])
  })

  it('normalizes vendor-prefixed cssText returned by the browser and flags isVendorPrefixed', async () => {
    const client = makeRuntimeClient({
      value: [
        { name: 'pulse', cssText: '@-webkit-keyframes pulse { 0% { opacity: 0 } 100% { opacity: 1 } }' },
        { name: 'slide', cssText: '@-moz-keyframes slide { from { x: 0 } }' },
      ],
    })
    const warnings: string[] = []
    const rules = await captureKeyframesFromRuntime(client, warnings)
    expect(rules).toHaveLength(2)
    expect(rules[0]?.cssText.startsWith('@keyframes pulse {')).toBe(true)
    expect(rules[0]?.isVendorPrefixed).toBe(true)
    expect(rules[1]?.cssText.startsWith('@keyframes slide {')).toBe(true)
    expect(rules[1]?.isVendorPrefixed).toBe(true)
  })

  it('emits a warning and returns [] when Runtime.evaluate fails', async () => {
    const client = makeRuntimeClient(new Error('runtime unavailable'))
    const warnings: string[] = []
    const rules = await captureKeyframesFromRuntime(client, warnings)
    expect(rules).toEqual([])
    expect(warnings).toContain('keyframes-runtime-enumeration-failed')
  })

  it('skips entries with empty name or empty cssText without throwing', async () => {
    const client = makeRuntimeClient({
      value: [
        { name: '', cssText: '@keyframes foo {}' },
        { name: 'bar', cssText: '' },
        { name: 'good', cssText: '@keyframes good { from { x: 0 } }' },
      ],
    })
    const warnings: string[] = []
    const rules = await captureKeyframesFromRuntime(client, warnings)
    expect(rules.map((r) => r.name)).toEqual(['good'])
  })

  it('returns [] when the response has no value array', async () => {
    const client = makeRuntimeClient({})
    const warnings: string[] = []
    const rules = await captureKeyframesFromRuntime(client, warnings)
    expect(rules).toEqual([])
    expect(warnings).toEqual([])
  })
})

describe('resolveKeyframes with mixed CDP + Runtime sources', () => {
  it('runtime entry wins over a prefixed CDP entry with the same name', () => {
    const parsed: ParsedKeyframeRule[] = [
      // From CDP CSS.getStyleSheetText — preserved vendor prefix in source
      { name: 'spin', cssText: '@keyframes spin { from { x: 0 } to { x: 1 } }', isVendorPrefixed: true },
      // From Runtime.evaluate — browser normalized cssText
      { name: 'spin', cssText: '@keyframes spin { from { x: 99 } to { x: 100 } }', isVendorPrefixed: false },
    ]
    const warnings: string[] = []
    const resolved = resolveKeyframes(['spin'], parsed, warnings)
    expect(resolved[0]?.cssText.includes('x: 99')).toBe(true)
  })

  it('falls back to CDP entry when runtime did not find that name (cross-origin sheet)', () => {
    const parsed: ParsedKeyframeRule[] = [
      // CDP found it because the matched sheet had a styleSheetId
      { name: 'cross', cssText: '@keyframes cross { from { y: 0 } }', isVendorPrefixed: false },
      // Runtime did not return 'cross' (cross-origin sheet threw on cssRules)
    ]
    const warnings: string[] = []
    const resolved = resolveKeyframes(['cross'], parsed, warnings)
    expect(resolved).toEqual([{ name: 'cross', cssText: '@keyframes cross { from { y: 0 } }' }])
    expect(warnings).not.toContain('keyframes-name-undefined:cross')
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
