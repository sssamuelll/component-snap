import { buildStableSelector, classifyComponent } from './core/snap'

type ContentMessage =
  | { type: 'GET_SELECTION' }
  | { type: 'START_INSPECT'; requestId: string }
  | { type: 'STOP_INSPECT' }
  | { type: 'CAPTURE_DONE'; requestId: string; folder?: string }

type ElementSnap = {
  title: string; url: string; selection: string;
  element?: {
    tag: string; id: string; classes: string[]; text: string; selector: string;
    selectedSelector?: string; html: string; css: string; freezeHtml: string; js: string; kind: string;
    targetFingerprint?: {
      stableSelector?: string
      selectedSelector?: string
      tagName: string
      id?: string
      classList: string[]
      textPreview?: string
      boundingBox: {
        x: number
        y: number
        width: number
        height: number
      }
      siblingIndex?: number
      childCount?: number
      attributeHints: Array<{ name: string; value: string }>
      ancestry: Array<{
        tagName: string
        id?: string
        classList: string[]
        siblingIndex?: number
      }>
      shadowContext?: {
        insideShadowRoot: boolean
        shadowDepth: number
        hostChain: string[]
      }
    }
  }
}

let isInspecting = false, isProcessing = false, currentRequestId: string | null = null
let overlay: HTMLDivElement | null = null, blocker: HTMLDivElement | null = null

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

const ALLOWED_ATTRS = new Set(['id', 'class', 'role', 'type', 'name', 'value', 'placeholder', 'href', 'src', 'alt', 'title', 'tabindex', 'for', 'aria-label', 'aria-labelledby', 'aria-describedby', 'aria-controls', 'aria-expanded', 'aria-haspopup', 'aria-selected', 'aria-checked', 'aria-hidden', 'viewbox', 'viewBox', 'd', 'cx', 'cy', 'r', 'x1', 'y1', 'x2', 'y2', 'points', 'transform', 'xmlns', 'version', 'preserveaspectratio', 'preserveAspectRatio', 'xlink:href', 'href'])
const ATTRIBUTE_HINT_NAMES = new Set(['id', 'role', 'type', 'name', 'placeholder', 'aria-label', 'aria-labelledby', 'aria-describedby', 'aria-controls', 'aria-expanded', 'aria-selected', 'aria-checked', 'alt', 'title', 'href', 'src', 'data-testid', 'data-test'])

const resolveUrl = (url: string) => {
  if (!url || url.startsWith('data:') || url.startsWith('http') || url.startsWith('//') || url.startsWith('#')) return url
  try { return new URL(url, window.location.href).href } catch { return url }
}

const assetCache = new Map<string, string>()
const toBase64 = async (url: string): Promise<string> => {
  if (!url || url.startsWith('data:') || url.startsWith('#')) return url
  if (assetCache.has(url)) return assetCache.get(url)!
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'FETCH_ASSET', url })
    if (resp?.ok && resp?.data) { assetCache.set(url, resp.data); return resp.data }
    return url
  } catch { return url }
}

const inlineResources = async (text: string): Promise<string> => {
  const matches = Array.from(text.matchAll(/url\(['"]?([^'")]*)['"]?\)/g))
  if (matches.length === 0) return text
  let result = text
  const tasks = matches.map(async (m) => ({ original: m[0], base64: `url("${await toBase64(resolveUrl(m[1]))}")` }))
  for (const r of await Promise.all(tasks)) result = result.split(r.original).join(r.base64)
  return result
}

const findVisualRoot = (target: HTMLElement) => {
  let best = target; const vArea = Math.max(1, window.innerWidth * window.innerHeight)
  const getScore = (el: HTMLElement) => {
    const cls = (el.className?.toString() || '').toLowerCase(), tag = el.tagName.toLowerCase(), style = window.getComputedStyle(el), box = el.getBoundingClientRect(), area = Math.max(1, box.width * box.height), areaRatio = area / vArea
    if (areaRatio > 0.95) return -1000
    const hasS = style.boxShadow !== 'none' && !style.boxShadow.includes('rgba(0, 0, 0, 0)'), hasR = parseFloat(style.borderRadius) > 4, hasBg = style.backgroundColor !== 'rgba(0, 0, 0, 0)' && style.backgroundColor !== 'transparent'
    const isS = cls.includes('container') || tag.includes('container') || cls.includes('wrapper') || cls.includes('rnnxgb') || cls.includes('pill') || cls.includes('shell') || tag === 'header' || tag === 'nav' || tag === 'form' || cls.includes('header') || tag === 'shreddit-app'
    const isC = cls.includes('search') || cls.includes('board') || cls.includes('card') || tag.includes('board') || cls.includes('menu') || cls.includes('bar')
    const hasRich = el.parentElement && Array.from(el.parentElement.children).some(s => ['svg', 'canvas', 'piece', 'button', 'input', 'img'].includes(s.tagName.toLowerCase()))
    let score = (hasS ? 60 : 0) + (hasR ? 40 : 0) + (hasBg ? 15 : 0) + (hasS && hasR ? 100 : 0) + (isS ? 150 : 0) + (isC ? 80 : 0) + (hasRich ? 60 : 0)
    if (areaRatio > 0.8) score -= 300
    return score
  }
  let curr = target
  for (let depth = 0; depth < 15 && curr && curr !== document.body; depth++) {
    if (getScore(curr) > 30) best = curr
    curr = curr.parentElement as HTMLElement
  }
  return best
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
        for (const sel of rule.selectorText.split(',').map(s => s.trim())) {
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
            } catch { continue }
          }
        }
      }
    } catch { continue }
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
          const text = rule.style.cssText, matches = text.match(/--[a-zA-Z0-9_-]+/g)
          if (matches) matches.forEach(n => names.add(n))
        }
      }
    } catch { continue }
  }
  return Array.from(names)
}

const getVariables = (el: HTMLElement) => {
  const vars = new Map<string, string>(), allNames = getAllUniqueVariableNames()
  const targetRoots: HTMLElement[] = [el]; let curr: HTMLElement | null = el.parentElement
  while (curr) { targetRoots.unshift(curr); curr = curr.parentElement }
  for (const root of targetRoots) {
    const computed = window.getComputedStyle(root)
    for (const name of allNames) { const val = computed.getPropertyValue(name).trim(); if (val) vars.set(name, val) }
    for (let i = 0; i < root.style.length; i++) {
      const prop = root.style[i]; if (prop.startsWith('--')) vars.set(prop, computed.getPropertyValue(prop).trim())
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
    } catch { continue }
  }
  return fontFaces.join('\n\n')
}

const defaultStylesCache = new Map<string, Record<string, string>>()

const getDefaultStyles = (tagName: string): Record<string, string> => {
  const key = tagName.toLowerCase(); if (defaultStylesCache.has(key)) return defaultStylesCache.get(key)!
  const iframe = document.createElement('iframe'); Object.assign(iframe.style, { visibility: 'hidden', width: '0', height: '0', position: 'absolute' }); document.body.appendChild(iframe)
  const doc = iframe.contentDocument || iframe.contentWindow?.document, styles: Record<string, string> = {}
  if (doc) {
    let targetParent: HTMLElement = doc.body
    if (key === 'li') { const ul = doc.createElement('ul'); doc.body.appendChild(ul); targetParent = ul }
    else if (['td', 'th', 'tr'].includes(key)) { const table = doc.createElement('table'), tbody = doc.createElement('tbody'); table.appendChild(tbody); doc.body.appendChild(table); targetParent = (key === 'tr') ? tbody : doc.createElement('tr'); if (key !== 'tr') tbody.appendChild(targetParent) }
    const temp = doc.createElement(tagName); targetParent.appendChild(temp)
    const computed = iframe.contentWindow!.getComputedStyle(temp)
    for (const prop of STYLE_PROPS) { styles[prop] = computed.getPropertyValue(prop) }
  }
  document.body.removeChild(iframe); defaultStylesCache.set(key, styles); return styles
}

const sanitizeSubtree = async (root: HTMLElement, picked: HTMLElement) => {
  const clone = deepCloneAndFlatten(root) as HTMLElement
  const originalNodes: (HTMLElement | SVGElement)[] = []
  walkUnified(root, (n) => originalNodes.push(n))
  
  const clonedNodes: (HTMLElement | SVGElement)[] = []
  const walkClone = (n: Node) => {
    if (n instanceof HTMLElement || n instanceof SVGElement) {
      clonedNodes.push(n)
      for (const child of Array.from(n.childNodes)) walkClone(child)
    }
  }
  walkClone(clone)

  const rootBox = root.getBoundingClientRect()
  clone.style.width = `${rootBox.width}px`; clone.style.height = `${rootBox.height}px`; clone.style.position = 'relative'

  const referencedIds = new Set<string>()
  originalNodes.forEach(node => {
    Array.from(node.attributes).forEach(attr => {
      const match = attr.value.match(/url\(#([^)]+)\)/) || attr.value.match(/^#(.+)$/)
      if (match) referencedIds.add(match[1])
    })
  })

  if (referencedIds.size) {
    const symbolDictionary = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    symbolDictionary.style.display = 'none'
    referencedIds.forEach(id => {
      const original = document.getElementById(id)
      if (original) symbolDictionary.appendChild(original.cloneNode(true))
    })
    if (symbolDictionary.children.length > 0) clone.prepend(symbolDictionary)
  }

  let css = ''
  const allVars = getVariables(root)
  if (allVars.size) {
    css += ':root {\n'
    for (const [name, val] of allVars.entries()) css += `  ${name}: ${await inlineResources(val)};\n`
    css += '}\n\n'
  }

  const CRITICAL = new Set(['display', 'position', 'width', 'height', 'aspect-ratio', 'color', 'font-family', 'font-size', 'font-weight', 'line-height', 'box-sizing', 'opacity', 'visibility', 'overflow', 'fill', 'stroke', 'stroke-width', 'content', 'z-index', 'transform', 'transform-origin', 'pointer-events', 'cursor', 'user-select', 'object-fit', 'vertical-align'])

  // MOTION FIDELITY: Scoped Atomic Stylesheet logic
  for (let index = 0; index < clonedNodes.length; index++) {
    const node = clonedNodes[index], orig = originalNodes[index]
    if (!orig) continue
    
    const comp = window.getComputedStyle(orig)
    const defaults = getDefaultStyles(orig.tagName)
    const selector = `[data-csnap="${index}"]`
    let block = `${selector} {\n`, hasProps = false

    for (const p of STYLE_PROPS) {
      const val = comp.getPropertyValue(p).trim()
      if (!val) continue
      if (CRITICAL.has(p) || val !== defaults[p] || p.includes('padding') || p.includes('margin') || p.includes('border') || p.includes('background') || p.startsWith('flex') || p.startsWith('grid') || p.startsWith('transition') || p.startsWith('animation') || p.includes('text') || p.includes('white-space')) {
        const inlined = await inlineResources(val)
        block += `  ${p}: ${inlined};\n`
        hasProps = true
      }
    }
    block += '}\n'
    if (hasProps) css += block + '\n'

    // Capture states for motion
    const states: (':hover' | ':focus' | ':active')[] = [':hover', ':focus', ':active']
    for (const s of states) {
      const decls = collectPseudoDeclarations(orig, s)
      if (decls.size) {
        let stateBlock = `${selector}${s} {\n`
        for (const [p, v] of decls.entries()) {
          stateBlock += `  ${p}: ${await inlineResources(v)};\n`
        }
        stateBlock += '}\n\n'
        css += stateBlock
      }
    }

    // Capture pseudo-elements
    for (const p of ["::before", "::after"] as const) {
      const pc = window.getComputedStyle(orig, p), c = pc.getPropertyValue("content")
      if (c && !['none', '""', "''"].includes(c)) {
        css += `${selector}${p} {\n  content: ${c};\n`
        for (const sp of STYLE_PROPS) { const v = pc.getPropertyValue(sp).trim(); if (v) css += `  ${sp}: ${v};\n` }
        css += '}\n\n'
      }
    }

    // Capture keyframes
    const anim = comp.animationName
    if (anim && anim !== 'none') {
      for (const n of anim.split(',').map(s => s.trim())) {
        const allSheets = getAllStyleSheetsRecursive()
        for (const sheet of allSheets) {
          try {
            for (const r of Array.from(sheet.cssRules)) { if (r instanceof CSSKeyframesRule && r.name === n) css += r.cssText + '\n\n' }
          } catch { continue }
        }
      }
    }

    // Attributes
    Array.from(node.attributes).forEach(attr => {
      const name = attr.name, lower = name.toLowerCase()
      const allowed = ALLOWED_ATTRS.has(name) || ALLOWED_ATTRS.has(lower) || lower.startsWith('aria-')
      if (!allowed) { node.removeAttribute(name); return }
      if (['src', 'href', 'poster', 'xlink:href'].includes(lower)) node.setAttribute(name, resolveUrl(attr.value))
    })
    
    node.setAttribute('data-csnap', String(index))
    if (orig === picked) node.setAttribute('data-csnap-picked', 'true')
    if (['style', 'script'].includes(node.tagName.toLowerCase())) node.remove()
  }

  const scheme = window.getComputedStyle(document.documentElement).colorScheme || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  const fontFaces = getUsedFontFaces()
  const reset = `*,*::before,*::after{box-sizing:border-box;} :root{color-scheme: ${scheme};}`
  const centering = `html,body{margin:0;padding:0;height:100vh;display:flex;align-items:center;justify-content:center;background-color:${scheme === 'dark' ? '#1a1a1b' : '#fff'};}#component-snap-root{display:contents;}`
  
  return { html: clone.outerHTML, css: `${fontFaces}\n\n${reset}\n${centering}\n\n${css}`, selectedSelector: `[data-csnap="${originalNodes.findIndex(n => n === picked)}"]` }
}

const buildComponentJs = (selector: string) => `// Component Snap Active Bootstrap
const rootSelector = ${JSON.stringify(selector)};
const root = document.querySelector(rootSelector);
if (!root) {
  console.warn('[component-snap] root not found:', rootSelector);
} else {
  console.log('[component-snap] Active Snapshot Mounted:', root);
  const interactive = root.querySelectorAll('button, a, input, [role="button"], piece, .piece');
  interactive.forEach(el => {
    el.addEventListener('click', (e) => {
      const ripple = document.createElement('div');
      ripple.style.cssText = 'position:fixed;width:20px;height:20px;background:rgba(59,130,246,0.4);border-radius:50%;pointer-events:none;transform:translate(-50%,-50%);transition:all 0.4s ease-out;z-index:9999;';
      ripple.style.left = e.clientX + 'px'; ripple.style.top = e.clientY + 'px';
      document.body.appendChild(ripple);
      setTimeout(() => { ripple.style.width = '100px'; ripple.style.height = '100px'; ripple.style.opacity = '0'; }, 10);
      setTimeout(() => ripple.remove(), 500);
    });
  });
}
`

const toCompactText = (value: string) => value.replace(/\s+/g, ' ').trim()

const getSiblingIndex = (el: HTMLElement) => {
  const parent = el.parentElement
  if (!parent) return undefined
  return Array.from(parent.children).indexOf(el)
}

const getAttributeHints = (el: HTMLElement) =>
  Array.from(el.attributes)
    .filter((attr) => ATTRIBUTE_HINT_NAMES.has(attr.name.toLowerCase()))
    .slice(0, 12)
    .map((attr) => ({ name: attr.name, value: toCompactText(attr.value).slice(0, 160) }))

const getNodeSummary = (el: HTMLElement) => ({
  tagName: el.tagName.toLowerCase(),
  id: el.id || undefined,
  classList: Array.from(el.classList).slice(0, 8),
  siblingIndex: getSiblingIndex(el),
})

const getAncestrySummary = (el: HTMLElement) => {
  const ancestry: ReturnType<typeof getNodeSummary>[] = []
  let current: HTMLElement | null = el.parentElement
  while (current && ancestry.length < 8) {
    ancestry.push(getNodeSummary(current))
    current = current.parentElement
  }
  return ancestry
}

const getShadowContext = (el: HTMLElement) => {
  const hostChain: string[] = []
  let shadowDepth = 0
  let root: Node = el
  while (true) {
    const nextRoot = root.getRootNode()
    if (!(nextRoot instanceof ShadowRoot) || !nextRoot.host) break
    shadowDepth += 1
    const host = nextRoot.host as HTMLElement
    const descriptor = `${host.tagName.toLowerCase()}${host.id ? `#${host.id}` : ''}${host.classList.length ? `.${Array.from(host.classList).slice(0, 2).join('.')}` : ''}`
    hostChain.push(descriptor)
    root = host
  }
  return {
    insideShadowRoot: shadowDepth > 0,
    shadowDepth,
    hostChain,
  }
}

const buildTargetFingerprint = (target: HTMLElement) => {
  const rect = target.getBoundingClientRect()
  return {
    stableSelector: buildStableSelector(target),
    selectedSelector: buildStableSelector(target),
    tagName: target.tagName.toLowerCase(),
    id: target.id || undefined,
    classList: Array.from(target.classList),
    textPreview: toCompactText(target.textContent || '').slice(0, 300) || undefined,
    boundingBox: {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    },
    siblingIndex: getSiblingIndex(target),
    childCount: target.children.length,
    attributeHints: getAttributeHints(target),
    ancestry: getAncestrySummary(target),
    shadowContext: getShadowContext(target),
  }
}

const ensureOverlay = () => {
  if (overlay) return overlay
  overlay = document.createElement('div'); overlay.id = '__component_snap_overlay__'
  Object.assign(overlay.style, { position: 'fixed', border: '2px solid #3b82f6', background: 'rgba(59,130,246,0.12)', pointerEvents: 'none', zIndex: '2147483647', display: 'none', boxSizing: 'border-box' })
  document.documentElement.appendChild(overlay); return overlay
}

const ensureBlocker = () => {
  if (blocker) return blocker
  blocker = document.createElement('div'); blocker.id = '__component_snap_blocker__'
  Object.assign(blocker.style, { position: 'fixed', inset: '0', zIndex: '2147483646', cursor: 'crosshair', background: 'transparent' })
  document.documentElement.appendChild(blocker); return blocker
}

const getUnderlyingElement = (x: number, y: number) => {
  const b = ensureBlocker(); b.style.display = 'none'
  const target = document.elementFromPoint(x, y) as HTMLElement | null
  b.style.display = 'block'; return target
}

const drawOverlay = (el: HTMLElement) => {
  const box = el.getBoundingClientRect(), node = ensureOverlay()
  node.style.display = 'block'; node.style.top = `${box.top}px`; node.style.left = `${box.left}px`; node.style.width = `${box.width}px`; node.style.height = `${box.height}px`
}

const stopInspect = () => {
  isInspecting = false; isProcessing = false; currentRequestId = null
  if (overlay) overlay.style.display = 'none'
  if (blocker) blocker.remove(); blocker = null
  window.removeEventListener('keydown', onKeyDown, true)
}

const onBlockerMouseMove = (event: MouseEvent) => {
  if (!isInspecting || isProcessing) return
  const target = getUnderlyingElement(event.clientX, event.clientY)
  if (!target || target.id === '__component_snap_overlay__') return
  drawOverlay(target)
}

const onBlockerClick = async (event: MouseEvent) => {
  if (!isInspecting || isProcessing || !currentRequestId) return
  isProcessing = true; event.preventDefault(); event.stopImmediatePropagation()
  const target = getUnderlyingElement(event.clientX, event.clientY)
  if (!target) { isProcessing = false; return }
  const targetFingerprint = buildTargetFingerprint(target)
  const captureRoot = findVisualRoot(target)
  const rect = captureRoot.getBoundingClientRect(), selector = buildStableSelector(captureRoot)
  const portable = await sanitizeSubtree(captureRoot, target)
  const snap: ElementSnap = {
    title: document.title, url: window.location.href, selection: window.getSelection()?.toString().trim() ?? '',
    element: {
      tag: captureRoot.tagName.toLowerCase(), id: captureRoot.id || '', classes: Array.from(captureRoot.classList),
      text: (target.textContent || '').trim().slice(0, 300), selector, selectedSelector: portable.selectedSelector,
      html: portable.html, css: portable.css, freezeHtml: portable.html,
      js: buildComponentJs(portable.selectedSelector || selector), kind: classifyComponent(target),
      targetFingerprint,
    },
  }
  chrome.runtime.sendMessage({ type: 'ELEMENT_SELECTED', requestId: currentRequestId, payload: snap, clipRect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height, dpr: window.devicePixelRatio || 1 } }, () => stopInspect())
}

const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); stopInspect() } }

const startInspect = (requestId: string) => {
  if (isInspecting) return
  isInspecting = true; isProcessing = false; currentRequestId = requestId
  const b = ensureBlocker()
  b.addEventListener('mousemove', onBlockerMouseMove, true)
  b.addEventListener('click', (e) => { onBlockerClick(e).catch(() => stopInspect()) }, true)
  window.addEventListener('keydown', onKeyDown, true)
}

chrome.runtime.onMessage.addListener((message: ContentMessage, _sender, sendResponse) => {
  if (message?.type === 'GET_SELECTION') { sendResponse({ ok: true, url: window.location.href, title: document.title, selection: window.getSelection()?.toString().trim() ?? '' }); return }
  if (message?.type === 'START_INSPECT') { startInspect(message.requestId); sendResponse({ ok: true }); return }
  if (message?.type === 'CAPTURE_DONE' && message.requestId === currentRequestId) { stopInspect(); sendResponse({ ok: true }); return }
  if (message?.type === 'STOP_INSPECT') { stopInspect(); sendResponse({ ok: true }) }
})
