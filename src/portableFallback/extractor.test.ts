import { beforeAll, describe, expect, it } from 'vitest'
import {
  PSEUDO_STATES,
  buildPortableFallbackComponentJs,
  buildPortableFallbackExtractionDiagnostics,
  buildSheetIndices,
  pickPseudoDeclarations,
} from './extractor'
import type {
  PortableFallbackExtractionStats,
  PseudoRuleIndexEntry,
  PseudoState,
} from './extractor'

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

beforeAll(() => {
  const g = globalThis as Record<string, unknown>
  if (typeof g.CSSKeyframesRule === 'undefined') {
    const probe = document.createElement('style')
    probe.textContent = '@keyframes __csnap_probe { from {} to {} }'
    document.head.appendChild(probe)
    const probeSheet = probe.sheet
    const ctor = probeSheet?.cssRules[0]?.constructor
    if (ctor) Object.defineProperty(g, 'CSSKeyframesRule', { value: ctor, configurable: true })
    probe.remove()
  }
})

const cssToSheet = (css: string): CSSStyleSheet => {
  const el = document.createElement('style')
  el.textContent = css
  document.head.appendChild(el)
  const sheet = el.sheet
  if (!sheet) throw new Error('failed to construct stylesheet from css')
  return sheet
}

const trackSheet = (sheet: CSSStyleSheet) => {
  const counter = { rules: 0 }
  const proxy = new Proxy(sheet, {
    get(target, prop, _receiver) {
      if (prop === 'cssRules') counter.rules += 1
      return Reflect.get(target, prop, target)
    },
  })
  return { proxy, counter }
}

const legacyNormalize = (selectorText: string) =>
  selectorText
    .replace(/:hover/g, '')
    .replace(/:focus-visible/g, '')
    .replace(/:focus-within/g, '')
    .replace(/:focus/g, '')
    .replace(/:active/g, '')
    .trim()

const legacyCollectPseudoDeclarations = (
  el: Element,
  pseudo: PseudoState,
  sheets: readonly CSSStyleSheet[],
): Map<string, string> => {
  const declarations = new Map<string, string>()
  for (const sheet of sheets) {
    try {
      for (const rule of Array.from(sheet.cssRules)) {
        if (!(rule instanceof CSSStyleRule) || !rule.selectorText.includes(pseudo)) continue
        for (const sel of rule.selectorText.split(',').map((s) => s.trim())) {
          if (!sel.includes(pseudo)) continue
          const norm = legacyNormalize(sel)
          if (!norm) continue
          try {
            if (el.matches(norm)) {
              for (let i = 0; i < rule.style.length; i += 1) {
                const p = rule.style[i]
                const val = rule.style.getPropertyValue(p).trim()
                if (val) declarations.set(p, val)
              }
            }
          } catch {
            continue
          }
        }
      }
    } catch {
      continue
    }
  }
  return declarations
}

describe('buildSheetIndices', () => {
  it('returns empty pseudo buckets and empty keyframes for an empty sheet array', () => {
    const indices = buildSheetIndices([])
    for (const state of PSEUDO_STATES) expect(indices.pseudo[state]).toEqual([])
    expect(indices.keyframes.size).toBe(0)
  })

  it('groups rules into hover, focus, and active buckets with selectors normalized', () => {
    const sheet = cssToSheet(`
      .btn:hover { color: red; background: blue }
      .input:focus { outline: 1px solid green }
      .item:active { transform: scale(0.95) }
      .static { color: black }
    `)
    const indices = buildSheetIndices([sheet])

    expect(indices.pseudo[':hover'].map((e) => e.selector)).toEqual(['.btn'])
    expect(indices.pseudo[':focus'].map((e) => e.selector)).toEqual(['.input'])
    expect(indices.pseudo[':active'].map((e) => e.selector)).toEqual(['.item'])

    const hoverDecls = indices.pseudo[':hover'][0].declarations
    expect(hoverDecls.get('color')).toBe('red')
    expect(hoverDecls.get('background-color') || hoverDecls.get('background')).toBeTruthy()
  })

  it('preserves insertion order of selectors across split selector lists', () => {
    const sheet = cssToSheet(`.a:hover, .b:hover, .c:hover { color: red }`)
    const indices = buildSheetIndices([sheet])
    expect(indices.pseudo[':hover'].map((e) => e.selector)).toEqual(['.a', '.b', '.c'])
  })

  it('shares the same declaration map across pseudo states for mixed selector lists', () => {
    const sheet = cssToSheet(`.a:hover, .b:focus { color: red }`)
    const indices = buildSheetIndices([sheet])
    const hoverEntry = indices.pseudo[':hover'][0]
    const focusEntry = indices.pseudo[':focus'][0]
    expect(hoverEntry.declarations).toBe(focusEntry.declarations)
    expect(hoverEntry.declarations.get('color')).toBe('red')
  })

  it('collects multiple @keyframes definitions with the same name in insertion order', () => {
    const sheet = cssToSheet(`
      @keyframes spin { from { opacity: 0 } to { opacity: 1 } }
      @keyframes pulse { from { transform: scale(1) } to { transform: scale(1.1) } }
      @keyframes spin { from { opacity: 0.5 } to { opacity: 1 } }
    `)
    const indices = buildSheetIndices([sheet])
    expect(indices.keyframes.size).toBe(2)
    const spin = indices.keyframes.get('spin')
    expect(spin?.length).toBe(2)
    expect(spin?.[0]).toContain('opacity: 0')
    expect(spin?.[1]).toContain('opacity: 0.5')
    expect(indices.keyframes.get('pulse')?.length).toBe(1)
  })

  it('skips sheets whose cssRules getter throws', () => {
    const good = cssToSheet(`.btn:hover { color: red }`)
    const tainted = new Proxy(good, {
      get(target, prop, _receiver) {
        if (prop === 'cssRules') throw new Error('SecurityError')
        return Reflect.get(target, prop, target)
      },
    })
    const indices = buildSheetIndices([tainted, good])
    expect(indices.pseudo[':hover'].map((e) => e.selector)).toEqual(['.btn'])
  })

  it('ignores rules that are neither CSSStyleRule nor CSSKeyframesRule', () => {
    const sheet = cssToSheet(`@media (min-width: 100px) { .x:hover { color: red } }`)
    const indices = buildSheetIndices([sheet])
    expect(indices.pseudo[':hover']).toEqual([])
    expect(indices.keyframes.size).toBe(0)
  })

  it('returns an empty bucket when a rule selector contains a pseudo only inside a different state', () => {
    const sheet = cssToSheet(`.a:hover { color: red }`)
    const indices = buildSheetIndices([sheet])
    expect(indices.pseudo[':focus']).toEqual([])
    expect(indices.pseudo[':active']).toEqual([])
  })
})

describe('pickPseudoDeclarations', () => {
  it('returns an empty map when the entries array is empty', () => {
    document.body.innerHTML = '<div class="a"></div>'
    const el = document.querySelector('.a')!
    expect(pickPseudoDeclarations(el, []).size).toBe(0)
  })

  it('returns an empty map when no entry selector matches the element', () => {
    document.body.innerHTML = '<div class="a"></div>'
    const el = document.querySelector('.a')!
    const decl = new Map<string, string>([['color', 'red']])
    const entries: PseudoRuleIndexEntry[] = [{ selector: '.never', declarations: decl }]
    expect(pickPseudoDeclarations(el, entries).size).toBe(0)
  })

  it('applies last-write-wins across multiple matching entries in iteration order', () => {
    document.body.innerHTML = '<div class="a b"></div>'
    const el = document.querySelector('.a')!
    const entries: PseudoRuleIndexEntry[] = [
      { selector: '.a', declarations: new Map([['color', 'red']]) },
      { selector: '.b', declarations: new Map([['color', 'blue'], ['background', 'pink']]) },
    ]
    const out = pickPseudoDeclarations(el, entries)
    expect(out.get('color')).toBe('blue')
    expect(out.get('background')).toBe('pink')
  })

  it('skips entries whose selector throws on Element.matches', () => {
    document.body.innerHTML = '<div class="a"></div>'
    const el = document.querySelector('.a')!
    const entries: PseudoRuleIndexEntry[] = [
      { selector: ':::', declarations: new Map([['color', 'red']]) },
      { selector: '.a', declarations: new Map([['color', 'green']]) },
    ]
    const out = pickPseudoDeclarations(el, entries)
    expect(out.get('color')).toBe('green')
  })
})

describe('extractor pseudo-rule index parity vs legacy implementation', () => {
  const css = `
    .card:hover { color: red; background: yellow }
    .card.primary:hover, .button:focus { color: blue }
    .button:active { transform: scale(0.95) }
    .static { color: black }
    .nested .item:hover { padding: 4px }
  `

  it('produces declarations identical to the legacy collect for matching elements', () => {
    document.body.innerHTML = `
      <div class="card primary"></div>
      <button class="button"></button>
      <div class="nested"><span class="item"></span></div>
    `
    const sheet = cssToSheet(css)
    const indices = buildSheetIndices([sheet])

    for (const el of Array.from(document.body.querySelectorAll('*'))) {
      for (const state of PSEUDO_STATES) {
        const legacy = legacyCollectPseudoDeclarations(el, state, [sheet])
        const next = pickPseudoDeclarations(el, indices.pseudo[state])
        expect(Array.from(next.entries())).toEqual(Array.from(legacy.entries()))
      }
    }
  })

  it('matches the legacy implementation across ten seeded random rule permutations', () => {
    document.body.innerHTML = `<div class="a"></div><div class="b"></div><div class="c"></div>`
    const declTokens = ['color: red', 'color: blue', 'padding: 2px', 'margin: 1px', 'opacity: 0.5']
    const classes = ['a', 'b', 'c']
    const states = [':hover', ':focus', ':active']
    let seed = 0xC0FFEE
    const rng = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0
      return seed / 0xFFFFFFFF
    }

    for (let perm = 0; perm < 10; perm += 1) {
      const ruleCount = 6 + Math.floor(rng() * 8)
      const ruleStrings: string[] = []
      for (let r = 0; r < ruleCount; r += 1) {
        const cls = classes[Math.floor(rng() * classes.length)]
        const state = states[Math.floor(rng() * states.length)]
        const tok = declTokens[Math.floor(rng() * declTokens.length)]
        ruleStrings.push(`.${cls}${state} { ${tok} }`)
      }
      const sheet = cssToSheet(ruleStrings.join('\n'))
      const indices = buildSheetIndices([sheet])
      for (const el of Array.from(document.body.querySelectorAll('*'))) {
        for (const state of PSEUDO_STATES) {
          const legacy = legacyCollectPseudoDeclarations(el, state, [sheet])
          const next = pickPseudoDeclarations(el, indices.pseudo[state])
          expect(Array.from(next.entries())).toEqual(Array.from(legacy.entries()))
        }
      }
    }
  })

  it('reads cssRules once per sheet during build vs once per call for the legacy collect', () => {
    document.body.innerHTML = `
      <div class="a"></div><div class="b"></div><div class="c"></div>
      <div class="d"></div><div class="e"></div><div class="f"></div>
      <div class="g"></div><div class="h"></div><div class="i"></div><div class="j"></div>
    `
    const sheet = cssToSheet(`.a:hover, .b:hover, .c:hover { color: red } .d:focus { padding: 2px }`)
    const elements = Array.from(document.body.querySelectorAll('div'))

    const legacyTracker = trackSheet(sheet)
    for (const el of elements) {
      for (const state of PSEUDO_STATES) legacyCollectPseudoDeclarations(el, state, [legacyTracker.proxy])
    }

    const newTracker = trackSheet(sheet)
    const indices = buildSheetIndices([newTracker.proxy])
    for (const el of elements) {
      for (const state of PSEUDO_STATES) pickPseudoDeclarations(el, indices.pseudo[state])
    }

    expect(legacyTracker.counter.rules).toBe(elements.length * PSEUDO_STATES.length)
    expect(newTracker.counter.rules).toBe(1)
    expect(newTracker.counter.rules).toBeLessThan(legacyTracker.counter.rules)
  })
})

describe('extractor refactor edge cases', () => {
  it('treats an empty subtree (zero matching elements) without index access amplification', () => {
    const tracker = trackSheet(cssToSheet(`.x:hover { color: red }`))
    buildSheetIndices([tracker.proxy])
    expect(tracker.counter.rules).toBe(1)
  })

  it('handles a single-element subtree (N=1) consistently with legacy output', () => {
    document.body.innerHTML = '<button class="btn"></button>'
    const sheet = cssToSheet(`.btn:hover { color: red }`)
    const el = document.querySelector('.btn')!
    const indices = buildSheetIndices([sheet])
    const legacy = legacyCollectPseudoDeclarations(el, ':hover', [sheet])
    const next = pickPseudoDeclarations(el, indices.pseudo[':hover'])
    expect(Array.from(next.entries())).toEqual(Array.from(legacy.entries()))
  })

  it('handles a duplicated selector across two rules with last-write-wins semantics', () => {
    document.body.innerHTML = '<div class="x"></div>'
    const sheet = cssToSheet(`.x:hover { color: red } .x:hover { color: blue }`)
    const el = document.querySelector('.x')!
    const indices = buildSheetIndices([sheet])
    const out = pickPseudoDeclarations(el, indices.pseudo[':hover'])
    expect(out.get('color')).toBe('blue')
  })

  it('handles already-sorted entry order identically to reverse-sorted entry order under last-write-wins', () => {
    document.body.innerHTML = '<div class="a b"></div>'
    const el = document.querySelector('.a')!
    const forward: PseudoRuleIndexEntry[] = [
      { selector: '.a', declarations: new Map([['color', 'red']]) },
      { selector: '.b', declarations: new Map([['color', 'blue']]) },
    ]
    const reversed = [...forward].reverse()
    expect(pickPseudoDeclarations(el, forward).get('color')).toBe('blue')
    expect(pickPseudoDeclarations(el, reversed).get('color')).toBe('red')
  })

  it('does not mutate the input sheets array when building the index', () => {
    const sheet = cssToSheet(`.x:hover { color: red }`)
    const sheets: CSSStyleSheet[] = [sheet]
    const snapshot = sheets.slice()
    buildSheetIndices(sheets)
    expect(sheets).toEqual(snapshot)
  })

  it('does not mutate the entries array passed to pickPseudoDeclarations', () => {
    document.body.innerHTML = '<div class="a"></div>'
    const el = document.querySelector('.a')!
    const entries: PseudoRuleIndexEntry[] = [
      { selector: '.a', declarations: new Map([['color', 'red']]) },
      { selector: '.b', declarations: new Map([['color', 'blue']]) },
    ]
    const lengthBefore = entries.length
    pickPseudoDeclarations(el, entries)
    expect(entries.length).toBe(lengthBefore)
  })
})
