import { buildStableSelector, classifyComponent } from './core/snap'

const contentWindow = window as typeof window & {
  __componentSnapReady?: boolean
  __componentSnapInjectedAt?: number
  __componentSnapLoadMeta?: Record<string, unknown>
  __componentSnapStartInspect?: (requestId: string) => { ok: boolean; requestId: string }
  __componentSnapStopInspect?: () => { ok: boolean }
}

contentWindow.__componentSnapReady = true
contentWindow.__componentSnapInjectedAt = Date.now()
import type { ActionTraceEventTypeV0, ActionTraceEventV0, MutationTraceActionRefV0, MutationTraceEventV0 } from './cdp/types'
import type { TargetClass, TargetSubtype } from './cdp/nodeMappingTypes'
import {
  buildPortableFallbackComponentJs,
  extractPortableFallbackSubtree,
  type PortableFallbackExtractionDiagnostics,
} from './portableFallback/extractor'

type ContentMessage =
  | { type: 'PING' }
  | { type: 'GET_SELECTION' }
  | { type: 'START_INSPECT'; requestId: string }
  | { type: 'STOP_INSPECT' }
  | { type: 'CAPTURE_DONE'; requestId: string; folder?: string }

type TargetClassification = {
  targetClass: TargetClass
  targetSubtype: TargetSubtype
  reasons: string[]
}

type ElementSnap = {
  title: string; url: string; selection: string;
  element?: {
    tag: string; id: string; classes: string[]; text: string; selector: string;
    selectedSelector?: string; html: string; css: string; freezeHtml: string; js: string; kind: string;
    portableFallback?: PortableFallbackExtractionDiagnostics
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
      targetClassHint?: TargetClass
      targetSubtypeHint?: TargetSubtype
      targetClassReasons?: string[]
    }
  }
}

let isInspecting = false, isProcessing = false, currentRequestId: string | null = null
let overlay: HTMLDivElement | null = null, blocker: HTMLDivElement | null = null
const MAX_ACTION_TRACE_EVENTS = 180
const MAX_MUTATION_TRACE_EVENTS = 240
const HOVER_SAMPLE_INTERVAL_MS = 120
const MUTATION_CORRELATION_WINDOW_MS = 1400
const MAX_MUTATION_TAG_NAMES = 8
let actionTraceStartAt = 0
let actionTraceEvents: ActionTraceEventV0[] = []
let mutationTraceEvents: MutationTraceEventV0[] = []
let lastHoverSignature = ''
let lastHoverAtMs = -Infinity
let lastCorrelatedActionRef: MutationTraceActionRefV0 | null = null
let mutationObserver: MutationObserver | null = null

const ATTRIBUTE_HINT_NAMES = new Set(['id', 'role', 'type', 'name', 'placeholder', 'aria-label', 'aria-labelledby', 'aria-describedby', 'aria-controls', 'aria-expanded', 'aria-selected', 'aria-checked', 'alt', 'title', 'href', 'src', 'data-testid', 'data-test'])
const TRACEABLE_MUTATION_ATTRS = new Set([
  'class',
  'style',
  'value',
  'checked',
  'selected',
  'disabled',
  'hidden',
  'open',
  'role',
  'aria-expanded',
  'aria-selected',
  'aria-checked',
  'aria-hidden',
  'aria-busy',
  'data-state',
])

const SCENE_TAG_NAMES = new Set(['piece', 'square', 'coord', 'coords', 'cg-board', 'cg-container', 'cg-wrap'])
const SCENE_CLASS_TOKENS = ['board', 'puzzle__board', 'main-board', 'cg-wrap', 'overlay', 'coords']
const SCENE_FRAME_CLASS_TOKENS = ['puzzle__board', 'main-board', 'cg-wrap', 'board', 'viewport', 'stage']
const SEARCH_SHELL_CLASS_TOKENS = ['rnnxgb', 'a8sbwf', 'searchbox', 'search', 'input-wrapper']
const SEARCH_PREFERRED_CLASS_TOKENS = ['rnnxgb', 'a8sbwf']

const getPromotionDescriptor = (el: HTMLElement) => {
  const tag = el.tagName.toLowerCase()
  const id = el.id ? `#${el.id}` : ''
  const cls = el.classList.length ? `.${Array.from(el.classList).slice(0, 3).join('.')}` : ''
  return `${tag}${id}${cls}`
}

const findVisualRoot = (target: HTMLElement) => {
  let best = target; const vArea = Math.max(1, window.innerWidth * window.innerHeight)
  const promotionPath = [getPromotionDescriptor(target)]
  let promotionReason: string | undefined
  const hasSceneMarkers = (el: HTMLElement) => {
    const tag = el.tagName.toLowerCase()
    const cls = (el.className?.toString() || '').toLowerCase()
    return SCENE_TAG_NAMES.has(tag) || SCENE_CLASS_TOKENS.some((token) => cls.includes(token))
  }
  const getSearchShellScore = (el: HTMLElement) => {
    const tag = el.tagName.toLowerCase()
    const cls = (el.className?.toString() || '').toLowerCase()
    const box = el.getBoundingClientRect()
    const area = Math.max(1, box.width * box.height)
    const viewportArea = Math.max(1, window.innerWidth * window.innerHeight)
    const areaRatio = area / viewportArea
    const hasSearchField = !!el.querySelector('textarea[name="q"], input[name="q"], textarea[role="combobox"], input[role="combobox"]')
    const hasControls = el.querySelectorAll('button, svg, input[type="submit"], [role="button"]').length >= 1
    if (!hasSearchField) return -1000
    if (areaRatio > 0.35) return -1000

    let score = 0
    if (SEARCH_PREFERRED_CLASS_TOKENS.some((token) => cls.includes(token))) score += 300
    if (tag === 'form' && el.getAttribute('role') === 'search') score += 220
    if (SEARCH_SHELL_CLASS_TOKENS.some((token) => cls.includes(token))) score += 120
    if (hasControls) score += 60
    score -= Math.round(areaRatio * 200)
    return score
  }

  const isSearchShellCandidate = (el: HTMLElement) => getSearchShellScore(el) > 0

  const isSearchTarget = (() => {
    const tag = target.tagName.toLowerCase()
    if (tag === 'textarea' || tag === 'input') {
      const name = (target.getAttribute('name') || '').toLowerCase()
      const role = (target.getAttribute('role') || '').toLowerCase()
      const cls = (target.className?.toString() || '').toLowerCase()
      if (name === 'q' || role === 'combobox' || cls.includes('glfyf')) return true
    }
    let curr: HTMLElement | null = target
    for (let depth = 0; depth < 8 && curr && curr !== document.body; depth++) {
      if (isSearchShellCandidate(curr)) return true
      curr = curr.parentElement
    }
    return false
  })()

  const isSceneFrameCandidate = (el: HTMLElement) => {
    const tag = el.tagName.toLowerCase()
    const cls = (el.className?.toString() || '').toLowerCase()
    if (cls.includes('puzzle__board') || cls.includes('main-board')) return true
    if (tag === 'cg-wrap' || tag === 'cg-container') return true
    if (SCENE_FRAME_CLASS_TOKENS.some((token) => cls.includes(token))) return true
    const style = window.getComputedStyle(el)
    return (style.position === 'relative' || style.position === 'absolute') && hasSceneMarkers(el)
  }
  const isSceneTarget = (() => {
    let curr: HTMLElement | null = target
    for (let depth = 0; depth < 8 && curr && curr !== document.body; depth++) {
      if (hasSceneMarkers(curr)) return true
      curr = curr.parentElement
    }
    return false
  })()
  const getScore = (el: HTMLElement) => {
    const cls = (el.className?.toString() || '').toLowerCase(), tag = el.tagName.toLowerCase(), style = window.getComputedStyle(el), box = el.getBoundingClientRect(), area = Math.max(1, box.width * box.height), areaRatio = area / vArea
    if (areaRatio > 0.95) return -1000
    const hasS = style.boxShadow !== 'none' && !style.boxShadow.includes('rgba(0, 0, 0, 0)'), hasR = parseFloat(style.borderRadius) > 4, hasBg = style.backgroundColor !== 'rgba(0, 0, 0, 0)' && style.backgroundColor !== 'transparent'
    const isS = cls.includes('container') || tag.includes('container') || cls.includes('wrapper') || cls.includes('rnnxgb') || cls.includes('pill') || cls.includes('shell') || tag === 'header' || tag === 'nav' || tag === 'form' || cls.includes('header') || tag === 'shreddit-app'
    const isC = cls.includes('search') || cls.includes('board') || cls.includes('card') || tag.includes('board') || cls.includes('menu') || cls.includes('bar')
    const hasRich = el.parentElement && Array.from(el.parentElement.children).some(s => ['svg', 'canvas', 'piece', 'button', 'input', 'img'].includes(s.tagName.toLowerCase()))
    const sceneTagged = hasSceneMarkers(el)
    const sceneContainer = sceneTagged && (tag === 'cg-container' || tag === 'cg-wrap' || cls.includes('puzzle__board') || cls.includes('main-board'))
    let score = (hasS ? 60 : 0) + (hasR ? 40 : 0) + (hasBg ? 15 : 0) + (hasS && hasR ? 100 : 0) + (isS ? 150 : 0) + (isC ? 80 : 0) + (hasRich ? 60 : 0)
    if (isSceneTarget) {
      score += sceneTagged ? 140 : 0
      score += sceneContainer ? 180 : 0
      score -= tag === 'piece' || tag === 'square' || tag === 'coord' ? 120 : 0
    }
    if (areaRatio > 0.8) score -= 300
    return score
  }
  let curr = target
  let bestSceneFrame: HTMLElement | null = null
  let bestSearchShell: HTMLElement | null = null
  let bestScenePromotionPath = [...promotionPath]
  let bestSearchPromotionPath = [...promotionPath]
  let bestSearchShellScore = -Infinity
  for (let depth = 0; depth < 15 && curr && curr !== document.body; depth++) {
    if (depth > 0) promotionPath.push(getPromotionDescriptor(curr))
    if (getScore(curr) > 30) best = curr
    if (isSceneTarget && isSceneFrameCandidate(curr)) {
      bestSceneFrame = curr
      bestScenePromotionPath = [...promotionPath]
    }
    if (isSearchTarget) {
      const searchScore = getSearchShellScore(curr)
      if (searchScore > bestSearchShellScore) {
        bestSearchShellScore = searchScore
        if (searchScore > 0) {
          bestSearchShell = curr
          bestSearchPromotionPath = [...promotionPath]
        }
      }
    }
    curr = curr.parentElement as HTMLElement
  }
  if (isSceneTarget && bestSceneFrame) {
    promotionReason = bestSceneFrame !== target ? 'promotion:scene-frame-preserving-root' : undefined
    return { root: bestSceneFrame, promotionReason, promotionPath: bestScenePromotionPath }
  }
  if (isSearchTarget && bestSearchShell) {
    promotionReason = bestSearchShell !== target ? 'promotion:search-shell-root' : undefined
    return { root: bestSearchShell, promotionReason, promotionPath: bestSearchPromotionPath }
  }
  promotionReason = best !== target ? 'promotion:visual-bounded-root' : undefined
  return { root: best, promotionReason, promotionPath }
}

const toCompactText = (value: string) => value.replace(/\s+/g, ' ').trim()
const toActionTextPreview = (value: string) => toCompactText(value).slice(0, 160)
const toMutationTextPreview = (value: string) => toCompactText(value).slice(0, 140)

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

const hasChartSignals = (target: HTMLElement, root: HTMLElement) => {
  const cls = `${target.className?.toString() || ''} ${root.className?.toString() || ''}`.toLowerCase()
  const svgCount = root.querySelectorAll('svg').length + (root.tagName.toLowerCase() === 'svg' ? 1 : 0)
  const canvasCount = root.querySelectorAll('canvas').length + (root.tagName.toLowerCase() === 'canvas' ? 1 : 0)
  const pathCount = root.querySelectorAll('path').length
  const polylineCount = root.querySelectorAll('polyline, polygon').length
  const lineCount = root.querySelectorAll('line').length
  const rectCount = root.querySelectorAll('rect').length
  const textCount = root.querySelectorAll('text').length
  const chartKeywords = ['chart', 'graph', 'plot', 'series', 'trend', 'analytics', 'axis']
  return (svgCount + canvasCount) >= 1 && (
    pathCount >= 2 ||
    polylineCount >= 1 ||
    lineCount >= 4 ||
    rectCount >= 6 ||
    textCount >= 3 ||
    chartKeywords.some((token) => cls.includes(token))
  )
}

const hasToolbarSignals = (target: HTMLElement, root: HTMLElement) => {
  const role = (root.getAttribute('role') || target.getAttribute('role') || '').toLowerCase()
  const controls = Array.from(root.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"]')) as HTMLElement[]
  const directControlChildren = Array.from(root.children).filter((child) => {
    const el = child as HTMLElement
    const tag = el.tagName.toLowerCase()
    const childRole = (el.getAttribute('role') || '').toLowerCase()
    return tag === 'button' || childRole === 'button'
  })
  const textLength = toCompactText(root.textContent || '').length
  const box = root.getBoundingClientRect()
  const isWide = box.width > box.height * 2
  return role === 'toolbar' || (controls.length >= 3 && directControlChildren.length >= 3 && isWide && textLength <= 40)
}

const hasNoisyContainerSignals = (root: HTMLElement) => {
  const headings = root.querySelectorAll('h1, h2, h3').length
  const paragraphs = root.querySelectorAll('p').length
  const badges = root.querySelectorAll('[class*="badge"], [class*="pill"]').length
  const cards = root.querySelectorAll('[class*="card"]').length
  const buttons = root.querySelectorAll('button, [role="button"]').length
  const progressLike = root.querySelectorAll('progress, [role="progressbar"]').length
  const divs = root.querySelectorAll('div').length
  const textLength = toCompactText(root.textContent || '').length
  const box = root.getBoundingClientRect()
  const area = Math.max(1, box.width * box.height)
  const viewportArea = Math.max(1, window.innerWidth * window.innerHeight)
  const areaRatio = area / viewportArea
  const multiRegion = root.children.length >= 2 && Array.from(root.children).filter((child) => (child as HTMLElement).getBoundingClientRect().width > 0).length >= 2
  return areaRatio > 0.12 && headings >= 1 && paragraphs >= 1 && multiRegion && (
    badges >= 1 || cards >= 1 || progressLike >= 1 || buttons >= 2 || divs >= 8 || textLength > 120
  )
}

const classifyTarget = (target: HTMLElement, captureRoot?: HTMLElement): TargetClassification => {
  const root = captureRoot || target
  const reasons: string[] = []
  const tag = target.tagName.toLowerCase()
  const rootTag = root.tagName.toLowerCase()
  const targetCls = (target.className?.toString() || '').toLowerCase()
  const rootCls = (root.className?.toString() || '').toLowerCase()

  const isSearchLike =
    ((tag === 'textarea' || tag === 'input') && (((target.getAttribute('name') || '').toLowerCase() === 'q') || ((target.getAttribute('role') || '').toLowerCase() === 'combobox') || targetCls.includes('glfyf'))) ||
    rootCls.includes('rnnxgb') || rootCls.includes('a8sbwf') || (rootTag === 'form' && (root.getAttribute('role') || '').toLowerCase() === 'search')
  if (isSearchLike) {
    reasons.push('class-evidence:search-field-present', 'class-evidence:functional-wrapper-present')
    return { targetClass: 'semantic-shell', targetSubtype: 'search-like', reasons }
  }

  const isSceneLike = SCENE_TAG_NAMES.has(tag) || SCENE_TAG_NAMES.has(rootTag) || SCENE_CLASS_TOKENS.some((token) => rootCls.includes(token))
  if (isSceneLike) {
    reasons.push('class-evidence:scene-primitives-present', 'class-evidence:frame-chain-required')
    return { targetClass: 'render-scene', targetSubtype: 'board-like', reasons }
  }

  if (hasChartSignals(target, root)) {
    reasons.push('class-evidence:chart-primitives-present', 'class-evidence:scene-visualization-dominant')
    return { targetClass: 'render-scene', targetSubtype: 'chart-like', reasons }
  }

  if (rootTag === 'form') {
    reasons.push('class-evidence:form-root')
    return { targetClass: 'interactive-composite', targetSubtype: 'form-like', reasons }
  }

  if (hasToolbarSignals(target, root)) {
    reasons.push('class-evidence:toolbar-cluster-present')
    return { targetClass: 'semantic-shell', targetSubtype: 'toolbar-like', reasons }
  }

  if (['button', 'input', 'textarea', 'select', 'img', 'svg'].includes(tag) && root === target) {
    reasons.push('class-evidence:leaf-interactive-node')
    return { targetClass: 'semantic-leaf', targetSubtype: 'generic', reasons }
  }

  if (hasNoisyContainerSignals(root)) {
    reasons.push('class-evidence:multi-region-dense-container')
    return { targetClass: 'noisy-container', targetSubtype: 'generic', reasons }
  }

  reasons.push('class-evidence:bounded-shell-default')
  return { targetClass: 'semantic-shell', targetSubtype: 'generic', reasons }
}

const buildTargetFingerprint = (
  target: HTMLElement,
  captureRoot?: HTMLElement,
  promotionMeta?: { promotionReason?: string; promotionPath?: string[] },
) => {
  const promotedRoot = captureRoot && captureRoot !== target ? captureRoot : undefined
  const fingerprintRoot = promotedRoot || target
  const rect = fingerprintRoot.getBoundingClientRect()
  const classification = classifyTarget(target, captureRoot)
  return {
    stableSelector: buildStableSelector(fingerprintRoot),
    selectedSelector: buildStableSelector(fingerprintRoot),
    originalStableSelector: buildStableSelector(target),
    originalSelectedSelector: buildStableSelector(target),
    promotedStableSelector: promotedRoot ? buildStableSelector(promotedRoot) : undefined,
    promotedSelectedSelector: promotedRoot ? buildStableSelector(promotedRoot) : undefined,
    promotionReason: promotionMeta?.promotionReason,
    promotionPath: promotionMeta?.promotionPath,
    tagName: fingerprintRoot.tagName.toLowerCase(),
    id: fingerprintRoot.id || undefined,
    classList: Array.from(fingerprintRoot.classList),
    textPreview: toCompactText(fingerprintRoot.textContent || '').slice(0, 300) || undefined,
    boundingBox: {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    },
    siblingIndex: getSiblingIndex(fingerprintRoot),
    childCount: fingerprintRoot.children.length,
    attributeHints: getAttributeHints(fingerprintRoot),
    ancestry: getAncestrySummary(fingerprintRoot),
    shadowContext: getShadowContext(fingerprintRoot),
    targetClassHint: classification.targetClass,
    targetSubtypeHint: classification.targetSubtype,
    targetClassReasons: classification.reasons,
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

const getActionTarget = (target: EventTarget | null): HTMLElement | null => {
  if (target instanceof HTMLElement) return target
  if (target instanceof SVGElement) return target.parentElement
  return null
}

const actionAtMs = () => {
  if (actionTraceStartAt <= 0) return 0
  return Math.max(0, Math.round(performance.now() - actionTraceStartAt))
}

const pushActionTrace = (event: ActionTraceEventV0) => {
  if (!isInspecting) return
  actionTraceEvents.push(event)
  if (actionTraceEvents.length > MAX_ACTION_TRACE_EVENTS) {
    actionTraceEvents = actionTraceEvents.slice(actionTraceEvents.length - MAX_ACTION_TRACE_EVENTS)
  }
}

const pushMutationTrace = (event: MutationTraceEventV0) => {
  if (!isInspecting) return
  mutationTraceEvents.push(event)
  if (mutationTraceEvents.length > MAX_MUTATION_TRACE_EVENTS) {
    mutationTraceEvents = mutationTraceEvents.slice(mutationTraceEvents.length - MAX_MUTATION_TRACE_EVENTS)
  }
}

const updateLastCorrelatedAction = (type: ActionTraceEventTypeV0, atMs: number) => {
  if (type === 'hover') return
  lastCorrelatedActionRef = { type, atMs }
}

const recordActionFromElement = (
  type: ActionTraceEventV0['type'],
  el: HTMLElement | null,
  extra?: Omit<ActionTraceEventV0, 'type' | 'atMs' | 'selector' | 'tagName'>,
) => {
  const event: ActionTraceEventV0 = {
    type,
    atMs: actionAtMs(),
  }
  if (el) {
    event.selector = buildStableSelector(el)
    event.tagName = el.tagName.toLowerCase()
  }
  if (extra?.text) event.text = extra.text
  if (extra?.key) event.key = extra.key
  if (extra?.code) event.code = extra.code
  if (typeof extra?.value === 'string') event.value = extra.value
  pushActionTrace(event)
  updateLastCorrelatedAction(type, event.atMs)
}

const isInternalSnapNode = (el: Element) =>
  el.id === '__component_snap_overlay__' ||
  el.id === '__component_snap_blocker__' ||
  !!el.closest('#__component_snap_overlay__') ||
  !!el.closest('#__component_snap_blocker__')

const getMutationTargetElement = (node: Node | null): HTMLElement | null => {
  if (node instanceof HTMLElement) return node
  if (node instanceof SVGElement) return node.parentElement
  return node?.parentElement instanceof HTMLElement ? node.parentElement : null
}

const getTagNameFromNode = (node: Node) => {
  if (node instanceof HTMLElement || node instanceof SVGElement) return node.tagName.toLowerCase()
  if (node.nodeType === Node.TEXT_NODE) return '#text'
  return '#node'
}

const pickMutationTagNames = (nodes: NodeList) => {
  const tags = Array.from(nodes)
    .slice(0, MAX_MUTATION_TAG_NAMES)
    .map(getTagNameFromNode)
  return tags.length ? tags : undefined
}

const isTraceableMutationAttribute = (name?: string | null) => {
  if (!name) return false
  const lower = name.toLowerCase()
  if (TRACEABLE_MUTATION_ATTRS.has(lower)) return true
  if (lower.startsWith('aria-')) return true
  if (lower.startsWith('data-state')) return true
  return false
}

const getCorrelatedActionRef = (atMs: number) => {
  if (!lastCorrelatedActionRef) return undefined
  if (atMs - lastCorrelatedActionRef.atMs > MUTATION_CORRELATION_WINDOW_MS) return undefined
  return lastCorrelatedActionRef
}

const recordMutationFromObserver = (mutation: MutationRecord) => {
  const atMs = actionAtMs()
  const target = getMutationTargetElement(mutation.target)
  if (!target || isInternalSnapNode(target)) return
  const selector = buildStableSelector(target)
  const tagName = target.tagName.toLowerCase()
  const actionRef = getCorrelatedActionRef(atMs)

  if (mutation.type === 'attributes') {
    const attributeName = mutation.attributeName?.toLowerCase()
    if (!isTraceableMutationAttribute(attributeName)) return
    const nextValue = attributeName ? target.getAttribute(attributeName) : null
    pushMutationTrace({
      type: 'attributes',
      atMs,
      selector,
      tagName,
      attributeName: attributeName || undefined,
      valuePreview: typeof nextValue === 'string' ? toMutationTextPreview(nextValue) : undefined,
      actionRef,
    })
    return
  }

  if (mutation.type === 'characterData') {
    const valuePreview = toMutationTextPreview(mutation.target.textContent || '')
    if (!valuePreview) return
    pushMutationTrace({
      type: 'characterData',
      atMs,
      selector,
      tagName,
      valuePreview,
      actionRef,
    })
    return
  }

  if (mutation.type === 'childList') {
    if (mutation.addedNodes.length === 0 && mutation.removedNodes.length === 0) return
    pushMutationTrace({
      type: 'childList',
      atMs,
      selector,
      tagName,
      addedNodes: mutation.addedNodes.length,
      removedNodes: mutation.removedNodes.length,
      addedTagNames: pickMutationTagNames(mutation.addedNodes),
      removedTagNames: pickMutationTagNames(mutation.removedNodes),
      actionRef,
    })
  }
}

const startMutationObserver = () => {
  if (mutationObserver) return
  mutationObserver = new MutationObserver((mutations) => {
    if (!isInspecting || isProcessing) return
    for (const mutation of mutations) recordMutationFromObserver(mutation)
  })
  mutationObserver.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeOldValue: false,
    characterData: true,
    characterDataOldValue: false,
  })
}

const stopMutationObserver = () => {
  mutationObserver?.disconnect()
  mutationObserver = null
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
  if (blocker) {
    blocker.removeEventListener('mousemove', onBlockerMouseMove, true)
    blocker.removeEventListener('click', onBlockerClickCapture, true)
  }
  window.removeEventListener('input', onGlobalInput, true)
  window.removeEventListener('focusin', onGlobalFocusIn, true)
  stopMutationObserver()
  if (overlay) overlay.style.display = 'none'
  if (blocker) blocker.remove(); blocker = null
  window.removeEventListener('keydown', onKeyDown, true)
}

const onBlockerMouseMove = (event: MouseEvent) => {
  if (!isInspecting || isProcessing) return
  const target = getUnderlyingElement(event.clientX, event.clientY)
  if (!target || target.id === '__component_snap_overlay__') return
  drawOverlay(target)
  const signature = `${buildStableSelector(target)}@${target.tagName.toLowerCase()}`
  const now = performance.now()
  if (signature !== lastHoverSignature && now - lastHoverAtMs >= HOVER_SAMPLE_INTERVAL_MS) {
    recordActionFromElement('hover', target)
    lastHoverSignature = signature
    lastHoverAtMs = now
  }
}

const onBlockerClick = async (event: MouseEvent) => {
  if (!isInspecting || isProcessing || !currentRequestId) return
  isProcessing = true; event.preventDefault(); event.stopImmediatePropagation()
  const target = getUnderlyingElement(event.clientX, event.clientY)
  if (!target) { isProcessing = false; return }
  recordActionFromElement('click', target, {
    text: toActionTextPreview(target.textContent || ''),
  })
  const visualRoot = findVisualRoot(target)
  const captureRoot = visualRoot.root
  const targetFingerprint = buildTargetFingerprint(target, captureRoot, visualRoot)
  const rect = captureRoot.getBoundingClientRect(), selector = buildStableSelector(captureRoot)
  const portable = await extractPortableFallbackSubtree(captureRoot, target)
  const snap: ElementSnap = {
    title: document.title, url: window.location.href, selection: window.getSelection()?.toString().trim() ?? '',
    element: {
      tag: captureRoot.tagName.toLowerCase(), id: captureRoot.id || '', classes: Array.from(captureRoot.classList),
      text: (target.textContent || '').trim().slice(0, 300), selector, selectedSelector: portable.selectedSelector,
      html: portable.html, css: portable.css, freezeHtml: portable.html,
      js: buildPortableFallbackComponentJs(portable.rootSelector || portable.selectedSelector || selector), kind: classifyComponent(target),
      portableFallback: portable.diagnostics,
      targetFingerprint,
    },
  }
  chrome.runtime.sendMessage(
    {
      type: 'ELEMENT_SELECTED',
      requestId: currentRequestId,
      payload: snap,
      actionTraceEvents,
      mutationTraceEvents,
      clipRect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height, dpr: window.devicePixelRatio || 1 },
    },
    () => stopInspect(),
  )
}

const onBlockerClickCapture = (event: MouseEvent) => {
  onBlockerClick(event).catch(() => stopInspect())
}

const onGlobalInput = (event: Event) => {
  if (!isInspecting || isProcessing) return
  const target = getActionTarget(event.target)
  if (!target) return

  const value =
    target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
      ? target.value
      : target.isContentEditable
        ? target.textContent || ''
        : ''
  recordActionFromElement('input', target, { value: toActionTextPreview(value) })
}

const onGlobalFocusIn = (event: FocusEvent) => {
  if (!isInspecting || isProcessing) return
  const target = getActionTarget(event.target)
  if (!target) return
  recordActionFromElement('focus', target)
}

const onKeyDown = (event: KeyboardEvent) => {
  if (!isInspecting) return
  recordActionFromElement('keyboard', getActionTarget(event.target), {
    key: event.key,
    code: event.code,
  })
  if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); stopInspect() }
}

export const onExecute = (meta?: Record<string, unknown>) => {
  contentWindow.__componentSnapReady = true
  contentWindow.__componentSnapInjectedAt = Date.now()
  contentWindow.__componentSnapLoadMeta = meta || {}
}

const startInspect = (requestId: string) => {
  if (isInspecting) return
  isInspecting = true; isProcessing = false; currentRequestId = requestId
  actionTraceStartAt = performance.now()
  actionTraceEvents = []
  mutationTraceEvents = []
  lastHoverSignature = ''
  lastHoverAtMs = -Infinity
  lastCorrelatedActionRef = null
  startMutationObserver()
  const b = ensureBlocker()
  b.addEventListener('mousemove', onBlockerMouseMove, true)
  b.addEventListener('click', onBlockerClickCapture, true)
  window.addEventListener('input', onGlobalInput, true)
  window.addEventListener('focusin', onGlobalFocusIn, true)
  window.addEventListener('keydown', onKeyDown, true)
}

contentWindow.__componentSnapStartInspect = (requestId: string) => {
  startInspect(requestId)
  return { ok: true, requestId }
}

contentWindow.__componentSnapStopInspect = () => {
  stopInspect()
  return { ok: true }
}

chrome.runtime.onMessage.addListener((message: ContentMessage, _sender, sendResponse) => {
  if (message?.type === 'PING') { sendResponse({ ok: true, href: window.location.href, ready: true }); return }
  if (message?.type === 'GET_SELECTION') { sendResponse({ ok: true, url: window.location.href, title: document.title, selection: window.getSelection()?.toString().trim() ?? '' }); return }
  if (message?.type === 'START_INSPECT') { startInspect(message.requestId); sendResponse({ ok: true }); return }
  if (message?.type === 'CAPTURE_DONE' && message.requestId === currentRequestId) { stopInspect(); sendResponse({ ok: true }); return }
  if (message?.type === 'STOP_INSPECT') { stopInspect(); sendResponse({ ok: true }) }
})
