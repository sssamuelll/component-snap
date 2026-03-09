export interface PortableFallbackExtractionStats {
  nodeCount: number
  shadowHostCount: number
  removedAttributeCount: number
  referencedSymbolCount: number
  pseudoStateRuleCount: number
  pseudoElementRuleCount: number
  keyframeRuleCount: number
  inlinedAssetRequestCount: number
  inlinedAssetFailureCount: number
}

export interface PortableFallbackExtractionDiagnostics {
  tier: 'portable-fallback'
  used: true
  confidence: number
  confidencePenalty: number
  warnings: string[]
  stats: PortableFallbackExtractionStats
}

export interface PortableFallbackExtractionResult {
  html: string
  css: string
  selectedSelector: string
  diagnostics: PortableFallbackExtractionDiagnostics
}

const STYLE_PROPS = [
  'display', 'position', 'top', 'right', 'bottom', 'left', 'width', 'height',
  'min-width', 'min-height', 'max-width', 'max-height', 'aspect-ratio',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
  'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
  'border-top-left-radius', 'border-top-right-radius', 'border-bottom-left-radius', 'border-bottom-right-radius',
  'background-color', 'background-image', 'background-size', 'background-position', 'background-repeat',
  'background-clip', 'background-origin', 'background-attachment',
  'color', 'font-family', 'font-size', 'font-weight', 'font-style', 'font-variant', 'font-stretch',
  'line-height', 'text-align', 'text-decoration', 'text-transform', 'text-indent',
  'text-rendering', 'text-overflow', 'letter-spacing', 'word-spacing', 'white-space', 'word-break', 'overflow-wrap',
  'box-shadow', 'opacity', 'visibility', 'overflow', 'overflow-x', 'overflow-y',
  'flex-direction', 'flex-wrap', 'flex-grow', 'flex-shrink', 'flex-basis',
  'align-items', 'align-content', 'align-self', 'justify-content', 'justify-items', 'justify-self',
  'gap', 'grid-template-columns', 'grid-template-rows', 'grid-column-start', 'grid-column-end', 'grid-row-start', 'grid-row-end',
  'transform', 'transform-origin', 'transform-style', 'perspective', 'backface-visibility',
  'box-sizing', 'cursor', 'pointer-events', 'z-index',
  'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray', 'stroke-dashoffset',
  'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'vector-effect',
  'marker-start', 'marker-mid', 'marker-end',
  'list-style-type', 'list-style-position', 'list-style-image',
  'mask-image', 'mask-size', 'mask-position', 'mask-repeat', 'clip-path', 'content',
  'outline-width', 'outline-style', 'outline-color', 'appearance', '-webkit-appearance',
  'transition-property', 'transition-duration', 'transition-timing-function', 'transition-delay',
  'animation-name', 'animation-duration', 'animation-timing-function', 'animation-delay', 'animation-iteration-count', 'animation-direction', 'animation-fill-mode',
  'user-select', 'object-fit', 'object-position', 'vertical-align',
]

const ALLOWED_ATTRS = new Set([
  'id',
  'class',
  'role',
  'type',
  'name',
  'value',
  'placeholder',
  'href',
  'src',
  'alt',
  'title',
  'tabindex',
  'for',
  'aria-label',
  'aria-labelledby',
  'aria-describedby',
  'aria-controls',
  'aria-expanded',
  'aria-haspopup',
  'aria-selected',
  'aria-checked',
  'aria-hidden',
  'viewbox',
  'viewBox',
  'd',
  'cx',
  'cy',
  'r',
  'x1',
  'y1',
  'x2',
  'y2',
  'points',
  'transform',
  'xmlns',
  'version',
  'preserveaspectratio',
  'preserveAspectRatio',
  'xlink:href',
])

const CRITICAL = new Set([
  'display',
  'position',
  'width',
  'height',
  'aspect-ratio',
  'color',
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'box-sizing',
  'opacity',
  'visibility',
  'overflow',
  'fill',
  'stroke',
  'stroke-width',
  'content',
  'z-index',
  'transform',
  'transform-origin',
  'pointer-events',
  'cursor',
  'user-select',
  'object-fit',
  'vertical-align',
])

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value))

const resolveUrl = (url: string) => {
  if (!url || url.startsWith('data:') || url.startsWith('http') || url.startsWith('//') || url.startsWith('#')) return url
  try {
    return new URL(url, window.location.href).href
  } catch {
    return url
  }
}

const assetCache = new Map<string, string>()

const toBase64 = async (url: string): Promise<string> => {
  if (!url || url.startsWith('data:') || url.startsWith('#')) return url
  if (assetCache.has(url)) return assetCache.get(url)!

  try {
    const resp = await chrome.runtime.sendMessage({ type: 'FETCH_ASSET', url })
    if (resp?.ok && resp?.data) {
      assetCache.set(url, resp.data)
      return resp.data
    }
    return url
  } catch {
    return url
  }
}

const getAllStyleSheetsRecursive = (root: Document | ShadowRoot = document): CSSStyleSheet[] => {
  const sheets: CSSStyleSheet[] = Array.from(root.styleSheets)
  const allNodes = Array.from(root.querySelectorAll('*'))
  for (const node of allNodes) {
    if (node.shadowRoot) sheets.push(...getAllStyleSheetsRecursive(node.shadowRoot))
  }
  return sheets
}

const normalizeSelectorForMatch = (selectorText: string) =>
  selectorText.replace(/:hover/g, '').replace(/:focus-visible/g, '').replace(/:focus-within/g, '').replace(/:focus/g, '').replace(/:active/g, '').trim()

const collectPseudoDeclarations = (el: HTMLElement | SVGElement, pseudo: ':hover' | ':focus' | ':active') => {
  const declarations = new Map<string, string>()
  const allSheets = getAllStyleSheetsRecursive()
  for (const sheet of allSheets) {
    try {
      const rules = sheet.cssRules
      for (const rule of Array.from(rules)) {
        if (!(rule instanceof CSSStyleRule) || !rule.selectorText.includes(pseudo)) continue
        for (const sel of rule.selectorText.split(',').map((s) => s.trim())) {
          if (!sel.includes(pseudo)) continue
          const norm = normalizeSelectorForMatch(sel)
          if (norm) {
            try {
              if (el.matches(norm)) {
                for (let i = 0; i < rule.style.length; i++) {
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
      }
    } catch {
      continue
    }
  }
  return declarations
}

const walkUnified = (node: Node, cb: (n: HTMLElement | SVGElement) => void) => {
  if (node instanceof HTMLElement || node instanceof SVGElement) {
    cb(node)
    if (node.shadowRoot) {
      for (const child of Array.from(node.shadowRoot.childNodes)) walkUnified(child, cb)
    }
  }
  for (const child of Array.from(node.childNodes)) walkUnified(child, cb)
}

const deepCloneAndFlatten = (node: Node): Node => {
  const clone = node.cloneNode(false)
  if (node instanceof HTMLElement || node instanceof SVGElement) {
    if (node.shadowRoot) {
      for (const child of Array.from(node.shadowRoot.childNodes)) clone.appendChild(deepCloneAndFlatten(child))
    }
  }
  for (const child of Array.from(node.childNodes)) clone.appendChild(deepCloneAndFlatten(child))
  return clone
}

const getAllUniqueVariableNames = () => {
  const names = new Set<string>()
  const allSheets = getAllStyleSheetsRecursive()
  for (const sheet of allSheets) {
    try {
      for (const rule of Array.from(sheet.cssRules)) {
        if (rule instanceof CSSStyleRule) {
          const text = rule.style.cssText
          const matches = text.match(/--[a-zA-Z0-9_-]+/g)
          if (matches) matches.forEach((n) => names.add(n))
        }
      }
    } catch {
      continue
    }
  }
  return Array.from(names)
}

const getVariables = (el: HTMLElement) => {
  const vars = new Map<string, string>()
  const allNames = getAllUniqueVariableNames()
  const targetRoots: HTMLElement[] = [el]
  let curr: HTMLElement | null = el.parentElement
  while (curr) {
    targetRoots.unshift(curr)
    curr = curr.parentElement
  }

  for (const root of targetRoots) {
    const computed = window.getComputedStyle(root)
    for (const name of allNames) {
      const val = computed.getPropertyValue(name).trim()
      if (val) vars.set(name, val)
    }
    for (let i = 0; i < root.style.length; i++) {
      const prop = root.style[i]
      if (prop.startsWith('--')) vars.set(prop, computed.getPropertyValue(prop).trim())
    }
  }
  return vars
}

const getUsedFontFaces = () => {
  const fontFaces: string[] = []
  const allSheets = getAllStyleSheetsRecursive()
  for (const sheet of allSheets) {
    try {
      for (const rule of Array.from(sheet.cssRules)) {
        if (rule instanceof CSSFontFaceRule) fontFaces.push(rule.cssText)
      }
    } catch {
      continue
    }
  }
  return fontFaces.join('\n\n')
}

const defaultStylesCache = new Map<string, Record<string, string>>()

const getDefaultStyles = (tagName: string): Record<string, string> => {
  const key = tagName.toLowerCase()
  if (defaultStylesCache.has(key)) return defaultStylesCache.get(key)!

  const iframe = document.createElement('iframe')
  Object.assign(iframe.style, { visibility: 'hidden', width: '0', height: '0', position: 'absolute' })
  document.body.appendChild(iframe)

  const doc = iframe.contentDocument || iframe.contentWindow?.document
  const styles: Record<string, string> = {}

  if (doc) {
    let targetParent: HTMLElement = doc.body
    if (key === 'li') {
      const ul = doc.createElement('ul')
      doc.body.appendChild(ul)
      targetParent = ul
    } else if (['td', 'th', 'tr'].includes(key)) {
      const table = doc.createElement('table')
      const tbody = doc.createElement('tbody')
      table.appendChild(tbody)
      doc.body.appendChild(table)
      targetParent = key === 'tr' ? tbody : doc.createElement('tr')
      if (key !== 'tr') tbody.appendChild(targetParent)
    }

    const temp = doc.createElement(tagName)
    targetParent.appendChild(temp)
    const computed = iframe.contentWindow!.getComputedStyle(temp)
    for (const prop of STYLE_PROPS) styles[prop] = computed.getPropertyValue(prop)
  }

  document.body.removeChild(iframe)
  defaultStylesCache.set(key, styles)
  return styles
}

const createInlineResourceInliner = (stats: PortableFallbackExtractionStats) => async (text: string): Promise<string> => {
  const matches = Array.from(text.matchAll(/url\(['"]?([^'")]*)['"]?\)/g))
  if (matches.length === 0) return text

  let result = text
  const tasks = matches.map(async (match) => {
    const resolved = resolveUrl(match[1])
    const data = await toBase64(resolved)
    stats.inlinedAssetRequestCount += 1
    if (!data.startsWith('data:') && data === resolved) stats.inlinedAssetFailureCount += 1
    return { original: match[0], base64: `url("${data}")` }
  })

  for (const item of await Promise.all(tasks)) {
    result = result.split(item.original).join(item.base64)
  }

  return result
}

export const buildPortableFallbackExtractionDiagnostics = (
  stats: PortableFallbackExtractionStats,
): PortableFallbackExtractionDiagnostics => {
  const warnings: string[] = [
    'portable-fallback-extractor-used',
    'portable-single-folder-export-is-lower-tier',
    'portable-fallback-is-not-replay-derived',
  ]

  let confidencePenalty = 0.32

  if (stats.shadowHostCount > 0) {
    warnings.push(`portable-fallback-shadow-dom-flattened:${stats.shadowHostCount}`)
    confidencePenalty += Math.min(0.2, stats.shadowHostCount * 0.04)
  }

  if (stats.removedAttributeCount > 0) {
    warnings.push(`portable-fallback-attributes-sanitized:${stats.removedAttributeCount}`)
    confidencePenalty += Math.min(0.1, stats.removedAttributeCount * 0.002)
  }

  if (stats.inlinedAssetFailureCount > 0) {
    warnings.push(`portable-fallback-asset-inline-failures:${stats.inlinedAssetFailureCount}`)
    confidencePenalty += Math.min(0.2, stats.inlinedAssetFailureCount * 0.03)
  }

  if (stats.pseudoStateRuleCount === 0) {
    warnings.push('portable-fallback-no-pseudo-state-rules-captured')
    confidencePenalty += 0.02
  }

  if (stats.keyframeRuleCount === 0) {
    warnings.push('portable-fallback-no-keyframes-captured')
    confidencePenalty += 0.02
  }

  if (stats.nodeCount > 160) {
    warnings.push(`portable-fallback-large-subtree:${stats.nodeCount}`)
    confidencePenalty += 0.05
  }

  confidencePenalty = clamp(confidencePenalty, 0, 0.92)
  const confidence = clamp(1 - confidencePenalty, 0.08, 1)

  return {
    tier: 'portable-fallback',
    used: true,
    confidence,
    confidencePenalty,
    warnings,
    stats,
  }
}

export const extractPortableFallbackSubtree = async (
  root: HTMLElement,
  picked: HTMLElement,
): Promise<PortableFallbackExtractionResult> => {
  const stats: PortableFallbackExtractionStats = {
    nodeCount: 0,
    shadowHostCount: 0,
    removedAttributeCount: 0,
    referencedSymbolCount: 0,
    pseudoStateRuleCount: 0,
    pseudoElementRuleCount: 0,
    keyframeRuleCount: 0,
    inlinedAssetRequestCount: 0,
    inlinedAssetFailureCount: 0,
  }

  const inlineResources = createInlineResourceInliner(stats)
  const clone = deepCloneAndFlatten(root) as HTMLElement
  const originalNodes: (HTMLElement | SVGElement)[] = []
  walkUnified(root, (node) => {
    stats.nodeCount += 1
    if (node.shadowRoot) stats.shadowHostCount += 1
    originalNodes.push(node)
  })

  const clonedNodes: (HTMLElement | SVGElement)[] = []
  const walkClone = (node: Node) => {
    if (node instanceof HTMLElement || node instanceof SVGElement) {
      clonedNodes.push(node)
      for (const child of Array.from(node.childNodes)) walkClone(child)
    }
  }
  walkClone(clone)

  const rootBox = root.getBoundingClientRect()
  clone.style.width = `${rootBox.width}px`
  clone.style.height = `${rootBox.height}px`
  clone.style.position = 'relative'

  const referencedIds = new Set<string>()
  originalNodes.forEach((node) => {
    Array.from(node.attributes).forEach((attr) => {
      const match = attr.value.match(/url\(#([^)]+)\)/) || attr.value.match(/^#(.+)$/)
      if (match) referencedIds.add(match[1])
    })
  })

  if (referencedIds.size) {
    const symbolDictionary = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    symbolDictionary.style.display = 'none'
    referencedIds.forEach((id) => {
      const original = document.getElementById(id)
      if (original) symbolDictionary.appendChild(original.cloneNode(true))
    })
    if (symbolDictionary.children.length > 0) {
      clone.prepend(symbolDictionary)
      stats.referencedSymbolCount = symbolDictionary.children.length
    }
  }

  let css = ''
  const allVars = getVariables(root)
  if (allVars.size) {
    css += ':root {\n'
    for (const [name, value] of allVars.entries()) css += `  ${name}: ${await inlineResources(value)};\n`
    css += '}\n\n'
  }

  for (let index = 0; index < clonedNodes.length; index++) {
    const node = clonedNodes[index]
    const original = originalNodes[index]
    if (!original) continue

    const computed = window.getComputedStyle(original)
    const defaults = getDefaultStyles(original.tagName)
    const selector = `[data-csnap="${index}"]`
    let block = `${selector} {\n`
    let hasProps = false

    for (const prop of STYLE_PROPS) {
      const value = computed.getPropertyValue(prop).trim()
      if (!value) continue
      if (
        CRITICAL.has(prop) ||
        value !== defaults[prop] ||
        prop.includes('padding') ||
        prop.includes('margin') ||
        prop.includes('border') ||
        prop.includes('background') ||
        prop.startsWith('flex') ||
        prop.startsWith('grid') ||
        prop.startsWith('transition') ||
        prop.startsWith('animation') ||
        prop.includes('text') ||
        prop.includes('white-space')
      ) {
        const inlined = await inlineResources(value)
        block += `  ${prop}: ${inlined};\n`
        hasProps = true
      }
    }

    block += '}\n'
    if (hasProps) css += `${block}\n`

    for (const state of [':hover', ':focus', ':active'] as const) {
      const declarations = collectPseudoDeclarations(original, state)
      if (declarations.size) {
        stats.pseudoStateRuleCount += 1
        let stateBlock = `${selector}${state} {\n`
        for (const [prop, value] of declarations.entries()) {
          stateBlock += `  ${prop}: ${await inlineResources(value)};\n`
        }
        stateBlock += '}\n\n'
        css += stateBlock
      }
    }

    for (const pseudo of ['::before', '::after'] as const) {
      const pseudoComputed = window.getComputedStyle(original, pseudo)
      const content = pseudoComputed.getPropertyValue('content')
      if (content && !['none', '""', "''"].includes(content)) {
        stats.pseudoElementRuleCount += 1
        css += `${selector}${pseudo} {\n  content: ${content};\n`
        for (const styleProp of STYLE_PROPS) {
          const value = pseudoComputed.getPropertyValue(styleProp).trim()
          if (value) css += `  ${styleProp}: ${value};\n`
        }
        css += '}\n\n'
      }
    }

    const animationName = computed.animationName
    if (animationName && animationName !== 'none') {
      for (const name of animationName.split(',').map((value) => value.trim())) {
        const allSheets = getAllStyleSheetsRecursive()
        for (const sheet of allSheets) {
          try {
            for (const rule of Array.from(sheet.cssRules)) {
              if (rule instanceof CSSKeyframesRule && rule.name === name) {
                stats.keyframeRuleCount += 1
                css += `${rule.cssText}\n\n`
              }
            }
          } catch {
            continue
          }
        }
      }
    }

    Array.from(node.attributes).forEach((attr) => {
      const name = attr.name
      const lower = name.toLowerCase()
      const allowed = ALLOWED_ATTRS.has(name) || ALLOWED_ATTRS.has(lower) || lower.startsWith('aria-')
      if (!allowed) {
        stats.removedAttributeCount += 1
        node.removeAttribute(name)
        return
      }
      if (['src', 'href', 'poster', 'xlink:href'].includes(lower)) node.setAttribute(name, resolveUrl(attr.value))
    })

    node.setAttribute('data-csnap', String(index))
    if (original === picked) node.setAttribute('data-csnap-picked', 'true')
    if (['style', 'script'].includes(node.tagName.toLowerCase())) node.remove()
  }

  const scheme =
    window.getComputedStyle(document.documentElement).colorScheme ||
    (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  const fontFaces = getUsedFontFaces()
  const reset = `*,*::before,*::after{box-sizing:border-box;} :root{color-scheme: ${scheme};}`
  const centering = `html,body{margin:0;padding:0;height:100vh;display:flex;align-items:center;justify-content:center;background-color:${scheme === 'dark' ? '#1a1a1b' : '#fff'};}#component-snap-root{display:contents;}`
  const selectedSelector = `[data-csnap="${originalNodes.findIndex((node) => node === picked)}"]`
  const diagnostics = buildPortableFallbackExtractionDiagnostics(stats)

  return {
    html: clone.outerHTML,
    css: `${fontFaces}\n\n${reset}\n${centering}\n\n${css}`,
    selectedSelector,
    diagnostics,
  }
}

export const buildPortableFallbackComponentJs = (selector: string) => `// Component Snap Portable Fallback Bootstrap
const rootSelector = ${JSON.stringify(selector)};
const root = document.querySelector(rootSelector);
if (!root) {
  console.warn('[component-snap] portable fallback root not found:', rootSelector);
} else {
  console.warn('[component-snap] portable fallback extraction active (lower-tier export)', root);
  const interactive = root.querySelectorAll('button, a, input, [role="button"], piece, .piece');
  interactive.forEach(el => {
    el.addEventListener('click', (e) => {
      const ripple = document.createElement('div');
      ripple.style.cssText = 'position:fixed;width:20px;height:20px;background:rgba(59,130,246,0.4);border-radius:50%;pointer-events:none;transform:translate(-50%,-50%);transition:all 0.4s ease-out;z-index:9999;';
      ripple.style.left = e.clientX + 'px';
      ripple.style.top = e.clientY + 'px';
      document.body.appendChild(ripple);
      setTimeout(() => {
        ripple.style.width = '100px';
        ripple.style.height = '100px';
        ripple.style.opacity = '0';
      }, 10);
      setTimeout(() => ripple.remove(), 500);
    });
  });
}
`
