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
    rawHtml: string
    rawCss: string
  }
}

let isInspecting = false
let currentRequestId: string | null = null
let overlay: HTMLDivElement | null = null
let blocker: HTMLDivElement | null = null

const STYLE_PROPS = [
  'display',
  'position',
  'top',
  'right',
  'bottom',
  'left',
  'width',
  'height',
  'min-width',
  'min-height',
  'max-width',
  'max-height',
  'margin',
  'padding',
  'border',
  'border-radius',
  'background',
  'background-color',
  'color',
  'font',
  'font-size',
  'font-weight',
  'line-height',
  'text-align',
  'text-decoration',
  'box-shadow',
  'opacity',
  'overflow',
  'overflow-x',
  'overflow-y',
  'flex',
  'flex-direction',
  'align-items',
  'justify-content',
  'gap',
  'grid-template-columns',
  'grid-template-rows',
  'transform',
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
])

const normalizeSelectorForMatch = (selectorText: string) =>
  selectorText
    .replace(/:hover/g, '')
    .replace(/:focus-visible/g, '')
    .replace(/:focus-within/g, '')
    .replace(/:focus/g, '')
    .replace(/:active/g, '')
    .trim()

const collectPseudoDeclarations = (el: HTMLElement, pseudo: ':hover' | ':focus') => {
  const declarations = new Map<string, string>()

  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList
    try {
      rules = sheet.cssRules
    } catch {
      continue
    }

    for (const rule of Array.from(rules)) {
      if (!(rule instanceof CSSStyleRule) || !rule.selectorText.includes(pseudo)) continue

      const selectors = rule.selectorText.split(',').map((s) => s.trim())
      for (const sel of selectors) {
        if (!sel.includes(pseudo)) continue
        const normalized = normalizeSelectorForMatch(sel)
        if (!normalized) continue

        try {
          if (!el.matches(normalized)) continue
        } catch {
          continue
        }

        for (let i = 0; i < rule.style.length; i++) {
          const prop = rule.style[i]
          const value = rule.style.getPropertyValue(prop)
          if (value) declarations.set(prop, value.trim())
        }
      }
    }
  }

  return declarations
}

const computedStyleToCss = (el: HTMLElement, selector: string) => {
  const computed = window.getComputedStyle(el)
  const activeDeclarations = new Map<string, string>()

  const maybeSetActive = (prop: string, declaredValue: string) => {
    const computedValue = computed.getPropertyValue(prop)?.trim()
    if (computedValue && declaredValue.trim() === computedValue) {
      activeDeclarations.set(prop, computedValue)
    }
  }

  for (let i = 0; i < el.style.length; i++) {
    const prop = el.style[i]
    const value = el.style.getPropertyValue(prop)
    if (value) maybeSetActive(prop, value)
  }

  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList
    try {
      rules = sheet.cssRules
    } catch {
      continue
    }

    for (const rule of Array.from(rules)) {
      if (!(rule instanceof CSSStyleRule)) continue
      try {
        if (!el.matches(rule.selectorText)) continue
      } catch {
        continue
      }
      for (let i = 0; i < rule.style.length; i++) {
        const prop = rule.style[i]
        const value = rule.style.getPropertyValue(prop)
        if (value) maybeSetActive(prop, value)
      }
    }
  }

  const baseLines = Array.from(activeDeclarations.entries()).map(([prop, value]) => `  ${prop}: ${value};`)
  const hoverLines = Array.from(collectPseudoDeclarations(el, ':hover').entries()).map(([prop, value]) => `  ${prop}: ${value};`)
  const focusLines = Array.from(collectPseudoDeclarations(el, ':focus').entries()).map(([prop, value]) => `  ${prop}: ${value};`)

  const base = baseLines.length
    ? `${selector} {\n${baseLines.join('\n')}\n}`
    : `${selector} {\n  /* No active readable declarations found */\n}`

  const hover = hoverLines.length ? `\n\n${selector}:hover {\n${hoverLines.join('\n')}\n}` : ''
  const focus = focusLines.length ? `\n\n${selector}:focus {\n${focusLines.join('\n')}\n}` : ''

  return `${base}${hover}${focus}`
}

const findVisualRoot = (target: HTMLElement) => {
  let current: HTMLElement | null = target
  let best = target
  let bestScore = -Infinity

  const viewportArea = Math.max(1, window.innerWidth * window.innerHeight)

  for (let depth = 0; depth < 10 && current && current !== document.body; depth++) {
    const cls = (current.className?.toString() || '').toLowerCase()
    const box = current.getBoundingClientRect()
    const style = window.getComputedStyle(current)
    const area = Math.max(1, box.width * box.height)
    const areaRatio = area / viewportArea

    // Hard guards: never capture page-level wrappers.
    if (areaRatio > 0.25 || box.height > 260 || box.width > window.innerWidth * 0.95) {
      current = current.parentElement
      continue
    }

    const hasSearchField = Boolean(current.querySelector('input, textarea, [role="combobox"]'))
    const hasRoundedShell = Number.parseFloat(style.borderRadius || '0') >= 12
    const hasVisibleBg = style.backgroundColor !== 'rgba(0, 0, 0, 0)'

    const classBoost = cls.includes('rnnxgb')
      ? 6
      : cls.includes('a8sbwf')
        ? 4
        : cls.includes('search')
          ? 2
          : 0

    const score =
      classBoost +
      (hasSearchField ? 2 : 0) +
      (hasRoundedShell ? 1.5 : 0) +
      (hasVisibleBg ? 1 : 0) -
      areaRatio * 5 -
      depth * 0.05

    if (score > bestScore) {
      best = current
      bestScore = score
    }

    current = current.parentElement
  }

  return best
}

const freezeSubtree = (root: HTMLElement) => {
  const clone = root.cloneNode(true) as HTMLElement
  const originalNodes = [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))]
  const clonedNodes = [clone, ...Array.from(clone.querySelectorAll<HTMLElement>('*'))]

  clonedNodes.forEach((node, index) => {
    const orig = originalNodes[index]
    if (!orig) return

    if (node.tagName.toLowerCase() === 'script' || node.tagName.toLowerCase() === 'style') {
      node.remove()
      return
    }

    const computed = window.getComputedStyle(orig)
    if (computed.display === 'none' || computed.visibility === 'hidden' || computed.opacity === '0') {
      node.remove()
      return
    }

    const stylePairs: string[] = []
    for (const prop of STYLE_PROPS) {
      const value = computed.getPropertyValue(prop).trim()
      if (!value) continue
      stylePairs.push(`${prop}:${value}`)
    }

    if (stylePairs.length) node.setAttribute('style', stylePairs.join(';'))

    Array.from(node.attributes).forEach((attr) => {
      const name = attr.name.toLowerCase()
      if (name === 'style') return
      const allowed = ALLOWED_ATTRS.has(name) || name.startsWith('aria-')
      if (!allowed) node.removeAttribute(attr.name)
    })
  })

  return clone.outerHTML
}

const sanitizeSubtree = (root: HTMLElement, picked: HTMLElement) => {
  const clone = root.cloneNode(true) as HTMLElement

  const originalNodes = [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))]
  const clonedNodes = [clone, ...Array.from(clone.querySelectorAll<HTMLElement>('*'))]

  clonedNodes.forEach((node, index) => {
    // Remove noisy/non-portable attrs
    Array.from(node.attributes).forEach((attr) => {
      const name = attr.name.toLowerCase()
      const allowed = ALLOWED_ATTRS.has(name) || name.startsWith('aria-')
      if (!allowed) node.removeAttribute(attr.name)
    })

    node.setAttribute('data-csnap', String(index))
    if (originalNodes[index] === picked) {
      node.setAttribute('data-csnap-picked', 'true')
    }

    // Remove inline style tags/scripts from subtree
    if (node.tagName.toLowerCase() === 'style' || node.tagName.toLowerCase() === 'script') {
      node.remove()
    }
  })

  const cssBlocks: string[] = []

  originalNodes.forEach((orig, index) => {
    if (!orig.isConnected) return
    const computed = window.getComputedStyle(orig)
    if (computed.display === 'none' || computed.visibility === 'hidden') return

    const selector = `[data-csnap="${index}"]`
    const declarations: string[] = []

    for (const prop of STYLE_PROPS) {
      const value = computed.getPropertyValue(prop).trim()
      if (!value) continue
      declarations.push(`  ${prop}: ${value};`)
    }

    if (declarations.length) {
      cssBlocks.push(`${selector} {\n${declarations.join('\n')}\n}`)
    }

    const hoverDecl = collectPseudoDeclarations(orig, ':hover')
    if (hoverDecl.size) {
      const lines = Array.from(hoverDecl.entries()).map(([prop, value]) => `  ${prop}: ${value};`)
      cssBlocks.push(`${selector}:hover {\n${lines.join('\n')}\n}`)
    }

    const focusDecl = collectPseudoDeclarations(orig, ':focus')
    if (focusDecl.size) {
      const lines = Array.from(focusDecl.entries()).map(([prop, value]) => `  ${prop}: ${value};`)
      cssBlocks.push(`${selector}:focus {\n${lines.join('\n')}\n}`)
    }
  })

  const pickedIndex = originalNodes.findIndex((n) => n === picked)
  const prelude = 'html,body{margin:0;padding:0;}#component-snap-root{display:inline-block;}'

  return {
    html: clone.outerHTML,
    css: `${prelude}\n\n${cssBlocks.join('\n\n')}`,
    selectedSelector: pickedIndex >= 0 ? `[data-csnap="${pickedIndex}"]` : undefined,
  }
}

const buildComponentJs = (selector: string) => `// Component Snap bootstrap
const rootSelector = ${JSON.stringify(selector)}
const root = document.querySelector(rootSelector)

if (!root) {
  console.warn('[component-snap] root not found:', rootSelector)
} else {
  console.log('[component-snap] root mounted:', root)
}
`

const ensureOverlay = () => {
  if (overlay) return overlay
  overlay = document.createElement('div')
  overlay.id = '__component_snap_overlay__'
  Object.assign(overlay.style, {
    position: 'fixed',
    border: '2px solid #3b82f6',
    background: 'rgba(59,130,246,0.12)',
    pointerEvents: 'none',
    zIndex: '2147483647',
    display: 'none',
    boxSizing: 'border-box',
  })
  document.documentElement.appendChild(overlay)
  return overlay
}

const ensureBlocker = () => {
  if (blocker) return blocker
  blocker = document.createElement('div')
  blocker.id = '__component_snap_blocker__'
  Object.assign(blocker.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '2147483646',
    cursor: 'crosshair',
    background: 'transparent',
  })
  document.documentElement.appendChild(blocker)
  return blocker
}

const getUnderlyingElement = (x: number, y: number) => {
  const b = ensureBlocker()
  b.style.display = 'none'
  const target = document.elementFromPoint(x, y) as HTMLElement | null
  b.style.display = 'block'
  return target
}

const drawOverlay = (el: HTMLElement) => {
  const box = el.getBoundingClientRect()
  const node = ensureOverlay()
  node.style.display = 'block'
  node.style.top = `${box.top}px`
  node.style.left = `${box.left}px`
  node.style.width = `${box.width}px`
  node.style.height = `${box.height}px`
}

const stopInspect = () => {
  isInspecting = false
  currentRequestId = null
  if (overlay) overlay.style.display = 'none'
  if (blocker) blocker.remove()
  blocker = null
  window.removeEventListener('keydown', onKeyDown, true)
}

const onBlockerMouseMove = (event: MouseEvent) => {
  if (!isInspecting) return
  const target = getUnderlyingElement(event.clientX, event.clientY)
  if (!target || target.id === '__component_snap_overlay__') return
  drawOverlay(target)
}

const onBlockerClick = (event: MouseEvent) => {
  if (!isInspecting || !currentRequestId) return
  event.preventDefault()
  event.stopImmediatePropagation()

  const target = getUnderlyingElement(event.clientX, event.clientY)
  if (!target) return

  const captureRoot = findVisualRoot(target)
  const rect = captureRoot.getBoundingClientRect()
  const selector = buildStableSelector(captureRoot)
  const rawHtml = captureRoot.outerHTML
  const rawCss = computedStyleToCss(captureRoot, selector)
  const portable = sanitizeSubtree(captureRoot, target)
  const freezeHtml = freezeSubtree(captureRoot)

  const snap: ElementSnap = {
    title: document.title,
    url: window.location.href,
    selection: window.getSelection()?.toString().trim() ?? '',
    element: {
      tag: captureRoot.tagName.toLowerCase(),
      id: captureRoot.id || '',
      classes: Array.from(captureRoot.classList),
      text: (target.textContent || '').trim().slice(0, 300),
      selector,
      selectedSelector: portable.selectedSelector,
      html: portable.html,
      css: portable.css,
      freezeHtml,
      rawHtml,
      rawCss,
      js: buildComponentJs(portable.selectedSelector || selector),
      kind: classifyComponent(target),
    },
  }

  chrome.runtime.sendMessage(
    {
      type: 'ELEMENT_SELECTED',
      requestId: currentRequestId,
      payload: snap,
      clipRect: {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
        dpr: window.devicePixelRatio || 1,
      },
    },
    () => {
      stopInspect()
    },
  )
}

const onKeyDown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopImmediatePropagation()
    stopInspect()
  }
}

const startInspect = (requestId: string) => {
  if (isInspecting) return
  isInspecting = true
  currentRequestId = requestId

  const b = ensureBlocker()
  b.addEventListener('mousemove', onBlockerMouseMove, true)
  b.addEventListener('click', onBlockerClick, true)
  window.addEventListener('keydown', onKeyDown, true)
}

chrome.runtime.onMessage.addListener((message: ContentMessage, _sender, sendResponse) => {
  if (message?.type === 'GET_SELECTION') {
    sendResponse({
      ok: true,
      url: window.location.href,
      title: document.title,
      selection: window.getSelection()?.toString().trim() ?? '',
    })
    return
  }

  if (message?.type === 'START_INSPECT') {
    startInspect(message.requestId)
    sendResponse({ ok: true })
    return
  }

  if (message?.type === 'CAPTURE_DONE' && message.requestId === currentRequestId) {
    stopInspect()
    sendResponse({ ok: true })
    return
  }

  if (message?.type === 'STOP_INSPECT') {
    stopInspect()
    sendResponse({ ok: true })
  }
})
