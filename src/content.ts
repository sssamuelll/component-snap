import { buildStableSelector, classifyComponent } from './core/snap'

type ContentMessage =
  | { type: 'GET_SELECTION' }
  | { type: 'START_INSPECT'; requestId: string }
  | { type: 'STOP_INSPECT' }
  | { type: 'CAPTURE_DONE'; requestId: string; folder?: string }

type ElementSnap = {
  title: string
  url: string
  selection: string
  element?: {
    tag: string
    id: string
    classes: string[]
    text: string
    selector: string
    selectedSelector?: string
    html: string
    css: string
    freezeHtml: string
    js: string
    kind: string
  }
}

let isInspecting = false
let isProcessing = false
let currentRequestId: string | null = null
let overlay: HTMLDivElement | null = null
let blocker: HTMLDivElement | null = null

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

const defaultStylesCache = new Map<string, Record<string, string>>()

const getDefaultStyles = (tagName: string): Record<string, string> => {
  const key = tagName.toLowerCase()
  if (defaultStylesCache.has(key)) return defaultStylesCache.get(key)!

  const iframe = document.createElement('iframe')
  iframe.style.visibility = 'hidden'
  iframe.style.width = '0'
  iframe.style.height = '0'
  iframe.style.position = 'absolute'
  document.body.appendChild(iframe)

  const doc = iframe.contentDocument || iframe.contentWindow?.document
  const styles: Record<string, string> = {}

  if (doc) {
    let targetParent: HTMLElement = doc.body
    if (key === 'li') {
      const ul = doc.createElement('ul')
      doc.body.appendChild(ul); targetParent = ul
    } else if (['td', 'th', 'tr'].includes(key)) {
      const table = doc.createElement('table')
      const tbody = doc.createElement('tbody')
      table.appendChild(tbody); doc.body.appendChild(table)
      targetParent = (key === 'tr') ? tbody : doc.createElement('tr')
      if (key !== 'tr') tbody.appendChild(targetParent)
    }
    const temp = doc.createElement(tagName)
    targetParent.appendChild(temp)
    const computed = iframe.contentWindow!.getComputedStyle(temp)
    for (const prop of STYLE_PROPS) { styles[prop] = computed.getPropertyValue(prop) }
  }
  document.body.removeChild(iframe)
  defaultStylesCache.set(key, styles)
  return styles
}

const getUsedFontFaces = () => {
  const fontFaces: string[] = []
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      for (const rule of Array.from(sheet.cssRules)) {
        if (rule instanceof CSSFontFaceRule) fontFaces.push(rule.cssText)
      }
    } catch { continue }
  }
  return fontFaces.join('\n\n')
}

const ALLOWED_ATTRS = new Set(['id', 'class', 'role', 'type', 'name', 'value', 'placeholder', 'href', 'src', 'alt', 'title', 'tabindex', 'for', 'aria-label', 'aria-labelledby', 'aria-describedby', 'aria-controls', 'aria-expanded', 'aria-haspopup', 'aria-selected', 'aria-checked', 'aria-hidden', 'onclick', 'onmousedown', 'onmouseup', 'onmouseover', 'onmouseout', 'onmouseenter', 'onmouseleave', 'onmousemove', 'onkeydown', 'onkeyup', 'onkeypress', 'onsubmit', 'onreset', 'onchange', 'onselect', 'oninput', 'onfocus', 'onblur', 'viewbox', 'viewBox', 'd', 'cx', 'cy', 'r', 'x1', 'y1', 'x2', 'y2', 'points', 'transform', 'xmlns', 'version', 'preserveaspectratio', 'preserveAspectRatio'])

const normalizeSelectorForMatch = (selectorText: string) =>
  selectorText.replace(/:hover/g, '').replace(/:focus-visible/g, '').replace(/:focus-within/g, '').replace(/:focus/g, '').replace(/:active/g, '').trim()

const collectPseudoDeclarations = (el: HTMLElement | SVGElement, pseudo: ':hover' | ':focus' | ':active') => {
  const declarations = new Map<string, string>()
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      for (const rule of Array.from(sheet.cssRules)) {
        if (!(rule instanceof CSSStyleRule) || !rule.selectorText.includes(pseudo)) continue
        for (const sel of rule.selectorText.split(',').map(s => s.trim())) {
          if (!sel.includes(pseudo)) continue
          const norm = normalizeSelectorForMatch(sel)
          if (norm && el.matches(norm)) {
            for (let i = 0; i < rule.style.length; i++) {
              const p = rule.style[i]
              declarations.set(p, rule.style.getPropertyValue(p).trim())
            }
          }
        }
      }
    } catch { continue }
  }
  return declarations
}

const resolveUrl = (url: string) => {
  if (!url || url.startsWith('data:') || url.startsWith('http') || url.startsWith('//')) return url
  try { return new URL(url, window.location.href).href } catch { return url }
}

const assetCache = new Map<string, string>()
const toBase64 = async (url: string): Promise<string> => {
  if (!url || url.startsWith('data:')) return url
  if (assetCache.has(url)) return assetCache.get(url)!
  try {
    const resp = await fetch(url)
    const blob = await resp.blob()
    const base64 = await new Promise<string>((resolve) => {
      const reader = new FileReader(); reader.onloadend = () => resolve(reader.result as string); reader.readAsDataURL(blob)
    })
    assetCache.set(url, base64); return base64
  } catch { return url }
}

const inlineAllResourcesInText = async (text: string): Promise<string> => {
  const matches = Array.from(text.matchAll(/url\(['"]?([^'")]*)['"]?\)/g))
  if (matches.length === 0) return text
  let result = text
  const tasks = matches.map(async (m) => ({ original: m[0], base64: `url("${await toBase64(resolveUrl(m[1]))}")` }))
  for (const r of await Promise.all(tasks)) result = result.split(r.original).join(r.base64)
  return result
}

const getPreferredColorScheme = () => {
  const html = document.documentElement;
  const body = document.body;
  const style = window.getComputedStyle(html);
  const bodyStyle = window.getComputedStyle(body);
  return style.colorScheme || bodyStyle.colorScheme || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}

const findVisualRoot = (target: HTMLElement) => {
  let best = target
  const vArea = Math.max(1, window.innerWidth * window.innerHeight)
  
  const getElementScore = (el: HTMLElement) => {
    const cls = (el.className?.toString() || '').toLowerCase()
    const tag = el.tagName.toLowerCase()
    const style = window.getComputedStyle(el)
    const box = el.getBoundingClientRect()
    const area = Math.max(1, box.width * box.height)
    const areaRatio = area / vArea

    if (areaRatio > 0.95) return -1000

    const hasShadow = style.boxShadow !== 'none' && !style.boxShadow.includes('rgba(0, 0, 0, 0)')
    const hasRadius = parseFloat(style.borderRadius) > 4
    const hasBg = style.backgroundColor !== 'rgba(0, 0, 0, 0)' && style.backgroundColor !== 'transparent'
    const hasBorder = style.borderStyle !== 'none' && style.borderWidth !== '0px'
    
    // Modern apps (Reddit, Google) use specific keywords for shells
    const isShell = cls.includes('container') || tag.includes('container') || cls.includes('wrapper') || 
                    cls.includes('rnnxgb') || cls.includes('pill') || cls.includes('shell') || 
                    tag === 'header' || tag === 'nav' || tag === 'form' || cls.includes('header')
    
    const isComponent = cls.includes('search') || cls.includes('board') || cls.includes('card') || 
                        tag.includes('board') || cls.includes('menu') || cls.includes('bar')
    
    const hasRichSiblings = el.parentElement && Array.from(el.parentElement.children).some(s => 
      ['svg', 'canvas', 'piece', 'button', 'input', 'img'].includes(s.tagName.toLowerCase())
    )

    let score = (hasShadow ? 60 : 0) + (hasRadius ? 40 : 0) + (hasBg ? 15 : 0) + (hasBorder ? 10 : 0)
    if (hasShadow && hasRadius) score += 100 // High confidence shell marker
    
    score += isShell ? 120 : 0
    score += isComponent ? 60 : 0
    score += hasRichSiblings ? 50 : 0
    
    // Penalize massive elements that are likely page layouts
    if (areaRatio > 0.8) score -= 300
    return score
  }

  let currentElement = target
  
  for (let depth = 0; depth < 15 && currentElement && currentElement !== document.body; depth++) {
    const score = getElementScore(currentElement)
    console.log(`[findVisualRoot] Checking ${currentElement.tagName}.${currentElement.className.toString().slice(0,20)} depth=${depth} score=${score.toFixed(2)}`)
    
    // If the score is high enough, this is a strong candidate for the "Shell"
    if (score > 30) {
      best = currentElement
      console.log(`[findVisualRoot] New potential shell: ${currentElement.tagName} (${score.toFixed(2)})`)
    }
    currentElement = currentElement.parentElement as HTMLElement
  }

  console.log(`[findVisualRoot] Final choice: ${best.tagName}`)
  return best
}

const freezeSubtree = async (root: HTMLElement) => {
  const clone = root.cloneNode(true) as HTMLElement
  const originalNodes = [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))]
  const clonedNodes = [clone, ...Array.from(clone.querySelectorAll<HTMLElement>('*'))]

  for (let index = 0; index < clonedNodes.length; index++) {
    const node = clonedNodes[index], orig = originalNodes[index]
    if (!orig) continue
    if (['script', 'style'].includes(node.tagName.toLowerCase())) { node.remove(); continue }
    const computed = window.getComputedStyle(orig)
    if (computed.display === 'none' || computed.visibility === 'hidden') { node.remove(); continue }

    const defaults = getDefaultStyles(orig.tagName)
    const stylePairs: string[] = []
    for (const prop of STYLE_PROPS) {
      const val = computed.getPropertyValue(prop).trim()
      if (!val || val === defaults[prop]) continue
      stylePairs.push(`${prop}:${await inlineAllResourcesInText(val)}`)
    }
    if (stylePairs.length) node.setAttribute('style', stylePairs.join(';'))

    Array.from(node.attributes).forEach(attr => {
      const name = attr.name, lower = name.toLowerCase()
      const allowed = ALLOWED_ATTRS.has(name) || ALLOWED_ATTRS.has(lower) || lower.startsWith('aria-')
      if (!allowed) { node.removeAttribute(name); return }
      if (['src', 'href', 'poster'].includes(lower)) node.setAttribute(name, resolveUrl(attr.value))
    })
  }
  return clone.outerHTML
}

const getAllUniqueVariableNames = () => {
  const names = new Set<string>()
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      for (const rule of Array.from(sheet.cssRules)) {
        if (rule instanceof CSSStyleRule) {
          const text = rule.style.cssText
          const matches = text.match(/--[a-zA-Z0-9_-]+/g)
          if (matches) matches.forEach(n => names.add(n))
        }
      }
    } catch { continue }
  }
  return Array.from(names)
}

const getVariables = (el: HTMLElement) => {
  const vars = new Map<string, string>()
  const allNames = getAllUniqueVariableNames()
  
  // Collect all ancestors up to html
  const targetRoots: HTMLElement[] = [el]
  let curr: HTMLElement | null = el.parentElement
  while (curr) {
    targetRoots.unshift(curr)
    curr = curr.parentElement
  }

  // Iterate from top to bottom so children override parents (standard CSS inheritance)
  for (const root of targetRoots) {
    const computed = window.getComputedStyle(root)
    for (const name of allNames) {
      const val = computed.getPropertyValue(name).trim()
      if (val) vars.set(name, val)
    }
    // Also check for inline style variables
    for (let i = 0; i < root.style.length; i++) {
      const prop = root.style[i]
      if (prop.startsWith('--')) {
        vars.set(prop, computed.getPropertyValue(prop).trim())
      }
    }
  }
  return vars
}

const getDeepAllNodes = (root: Node): Node[] => {
  const nodes: Node[] = [root];
  if (root instanceof HTMLElement || root instanceof SVGElement) {
    if (root.shadowRoot) {
      nodes.push(...getDeepAllNodes(root.shadowRoot));
    }
    for (const child of Array.from(root.childNodes)) {
      nodes.push(...getDeepAllNodes(child));
    }
  } else if (root instanceof ShadowRoot) {
    for (const child of Array.from(root.childNodes)) {
      nodes.push(...getDeepAllNodes(child));
    }
  }
  return nodes;
}

const deepCloneNode = (node: Node): Node => {
  const clone = node.cloneNode(false);
  
  if (node instanceof HTMLElement || node instanceof SVGElement) {
    if (node.shadowRoot) {
      const shadowClone = (clone as HTMLElement).attachShadow({ mode: node.shadowRoot.mode });
      for (const child of Array.from(node.shadowRoot.childNodes)) {
        shadowClone.appendChild(deepCloneNode(child));
      }
    }
  }
  
  for (const child of Array.from(node.childNodes)) {
    clone.appendChild(deepCloneNode(child));
  }
  
  return clone;
}

const sanitizeSubtree = async (root: HTMLElement, picked: HTMLElement) => {
  const clone = deepCloneNode(root) as HTMLElement
  const originalNodes = getDeepAllNodes(root).filter(n => n instanceof HTMLElement || n instanceof SVGElement) as (HTMLElement | SVGElement)[]
  
  // To keep indexing stable for [data-csnap], we need a matching traversal for the clone
  const clonedNodes = getDeepAllNodes(clone).filter(n => n instanceof HTMLElement || n instanceof SVGElement) as (HTMLElement | SVGElement)[]

  const rootBox = root.getBoundingClientRect()
  clone.style.width = `${rootBox.width}px`; clone.style.height = `${rootBox.height}px`; clone.style.position = 'relative'

  clonedNodes.forEach((node, index) => {
    const orig = originalNodes[index];
    if (!orig) return;

    Array.from(node.attributes).forEach(attr => {
      const name = attr.name, lower = name.toLowerCase()
      const allowed = ALLOWED_ATTRS.has(name) || ALLOWED_ATTRS.has(lower) || lower.startsWith('aria-')
      if (!allowed) { node.removeAttribute(name); return }
      if (['src', 'href', 'poster'].includes(lower)) node.setAttribute(name, resolveUrl(attr.value))
    })
    node.setAttribute('data-csnap', String(index))
    if (orig === picked) node.setAttribute('data-csnap-picked', 'true')
    if (['style', 'script'].includes(node.tagName.toLowerCase())) node.remove()
  })

  let css = ''
  const allVars = getVariables(root)
  if (allVars.size) {
    css += ':root {\n'
    for (const [name, val] of allVars.entries()) css += `  ${name}: ${val};\n`
    css += '}\n\n'
  }

  const defsToInclude = new Set<string>()
  originalNodes.forEach(node => {
    Array.from(node.attributes).forEach(attr => {
      const m = attr.value.match(/url\(#([^)]+)\)/); if (m) defsToInclude.add(m[1])
    })
    const style = window.getComputedStyle(node)
    const mProps = ['marker-start', 'marker-mid', 'marker-end', 'clip-path', 'mask']
    mProps.forEach(p => { const m = style.getPropertyValue(p).match(/url\(#([^)]+)\)/); if (m) defsToInclude.add(m[1]) })
  })

  if (defsToInclude.size) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.style.display = 'none'; const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs'); svg.appendChild(defs)
    defsToInclude.forEach(id => { const o = document.getElementById(id); if (o) defs.appendChild(o.cloneNode(true)) })
    if (defs.children.length > 0) clone.prepend(svg)
  }

  const CRITICAL = new Set(['display', 'position', 'width', 'height', 'aspect-ratio', 'color', 'font-family', 'font-size', 'font-weight', 'line-height', 'box-sizing', 'opacity', 'visibility', 'overflow', 'fill', 'stroke', 'stroke-width', 'content', 'z-index', 'transform', 'transform-origin', 'pointer-events', 'cursor', 'user-select', 'object-fit', 'vertical-align'])

  for (let index = 0; index < originalNodes.length; index++) {
    const orig = originalNodes[index]
    if (!orig.isConnected) continue
    const computed = window.getComputedStyle(orig), defaults = getDefaultStyles(orig.tagName)
    const selector = `[data-csnap="${index}"]`
    let block = `${selector} {\n`, hasProps = false

    for (const p of STYLE_PROPS) {
      const val = computed.getPropertyValue(p).trim()
      if (!val) continue
      const isC = CRITICAL.has(p) || p.includes('padding') || p.includes('margin') || p.includes('border') || p.includes('background') || p.startsWith('flex') || p.startsWith('grid') || p.startsWith('transition') || p.startsWith('animation') || p.includes('text') || p.includes('white-space')
      if (isC || val !== defaults[p]) { block += `  ${p}: ${val};\n`; hasProps = true }
    }
    block += '}\n'; if (hasProps) css += block + '\n'

    const states: (':hover' | ':focus' | ':active')[] = [':hover', ':focus', ':active']
    for (const s of states) {
      const decls = collectPseudoDeclarations(orig, s)
      if (decls.size) {
        css += `${selector}${s} {\n`
        for (const [p, v] of decls.entries()) css += `  ${p}: ${v};\n`
        css += '}\n\n'
      }
    }

    for (const p of ["::before", "::after"] as const) {
      const pc = window.getComputedStyle(orig, p), c = pc.getPropertyValue("content")
      if (c && !['none', '""', "''"].includes(c)) {
        css += `${selector}${p} {\n  content: ${c};\n`
        for (const sp of STYLE_PROPS) { const v = pc.getPropertyValue(sp).trim(); if (v) css += `  ${sp}: ${v};\n` }
        css += '}\n\n'
      }
    }

    const anim = computed.animationName
    if (anim && anim !== 'none') {
      for (const n of anim.split(',').map(s => s.trim())) {
        for (const sheet of Array.from(document.styleSheets)) {
          try {
            for (const r of Array.from(sheet.cssRules)) { if (r instanceof CSSKeyframesRule && r.name === n) css += r.cssText + '\n\n' }
          } catch { continue }
        }
      }
    }
  }

  const inlinedCss = await inlineAllResourcesInText(css)
  const fontFaces = getUsedFontFaces()
  const scheme = getPreferredColorScheme()
  const reset = `*,*::before,*::after{box-sizing:border-box;} :root{color-scheme: ${scheme};}`
  const bgColor = scheme === 'dark' ? '#1a1a1b' : '#fff'
  const centering = `html,body{margin:0;padding:0;height:100vh;display:flex;align-items:center;justify-content:center;background-color:${bgColor};}#component-snap-root{display:block;}`
  
  return {
    html: clone.outerHTML,
    css: `${fontFaces}\n\n${reset}\n${centering}\n\n${inlinedCss}`,
    selectedSelector: originalNodes.findIndex((n) => n === picked) >= 0 ? `[data-csnap="${originalNodes.findIndex((n) => n === picked)}"]` : undefined,
  }
}

const buildComponentJs = (selector: string) => `// Component Snap Active Bootstrap
const rootSelector = ${JSON.stringify(selector)};
const root = document.querySelector(rootSelector);
if (!root) {
  console.warn('[component-snap] root not found:', rootSelector);
} else {
  let activeElement = null, startX = 0, startY = 0, initialTransform = '';
  const isDraggable = (el) => {
    const tag = el.tagName.toLowerCase(), style = window.getComputedStyle(el);
    return tag === 'piece' || el.classList.contains('piece') || style.cursor === 'grab' || style.cursor === 'pointer';
  };
  root.addEventListener('mousedown', (e) => {
    const target = e.target.closest('*');
    if (target && isDraggable(target)) {
      activeElement = target; startX = e.clientX; startY = e.clientY; initialTransform = target.style.transform || '';
      activeElement.style.zIndex = '1000'; activeElement.style.cursor = 'grabbing'; e.preventDefault();
    }
  });
  window.addEventListener('mousemove', (e) => {
    if (!activeElement) return;
    const dx = e.clientX - startX, dy = e.clientY - startY;
    const tm = initialTransform.match(/translate\\(([^,)]+),?([^)]*)\\)/) || initialTransform.match(/translate3d\\(([^,)]+),?([^,)]+),?([^)]*)\\)/);
    if (tm) {
      activeElement.style.transform = \`translate(\${parseFloat(tm[1]) + dx}px, \${parseFloat(tm[2]) + dy}px)\`;
    } else {
      activeElement.style.transform = \`translate(\${dx}px, \${dy}px)\`;
    }
  });
  window.addEventListener('mouseup', () => { if (activeElement) { activeElement.style.zIndex = ''; activeElement.style.cursor = ''; activeElement = null; } });
}
`

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
  node.style.display = 'block'
  node.style.top = `${box.top}px`; node.style.left = `${box.left}px`; node.style.width = `${box.width}px`; node.style.height = `${box.height}px`
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
  const captureRoot = findVisualRoot(target)
  const rect = captureRoot.getBoundingClientRect(), selector = buildStableSelector(captureRoot)
  const portable = await sanitizeSubtree(captureRoot, target)
  const freezeHtml = await freezeSubtree(captureRoot)
  const snap: ElementSnap = {
    title: document.title, url: window.location.href, selection: window.getSelection()?.toString().trim() ?? '',
    element: {
      tag: captureRoot.tagName.toLowerCase(), id: captureRoot.id || '', classes: Array.from(captureRoot.classList),
      text: (target.textContent || '').trim().slice(0, 300), selector, selectedSelector: portable.selectedSelector,
      html: portable.html, css: portable.css, freezeHtml,
      js: buildComponentJs(portable.selectedSelector || selector), kind: classifyComponent(target),
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
