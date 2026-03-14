import type { TargetSubtreeV0 } from './types'

export interface TargetCandidateSubtreeV0 {
  html: string
  source: 'normalized-subtree' | 'reconstructed-subtree'
  removedTagCounts: Record<string, number>
  removedAttributeCounts: Record<string, number>
  collapsedWrapperCount: number
  compactedSvgCount: number
  nodeCount: number
  textLength: number
  reconstruction?: {
    mode: 'semantic' | 'scene-preserving'
    preservedEmptyScenePrimitiveCount: number
    preservedCustomElementCount: number
    preservedLayeredElementCount: number
  }
  quality?: {
    anchorNodeCount: number
    wrapperNodeCount: number
    textNodeCount: number
    anchorDensity: number
    wrapperDensity: number
    wrapperToAnchorRatio?: number
    profile: 'anchor-dense' | 'balanced' | 'wrapper-heavy' | 'scene-like'
  }
  warnings?: string[]
}

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'])
const NOISE_TAGS = new Set(['script', 'style', 'template', 'slot', 'noscript'])
const SVG_COMPACT_KEEP_ATTRS = new Set([
  'class',
  'id',
  'role',
  'aria-hidden',
  'viewbox',
  'viewBox',
  'width',
  'height',
  'fill',
  'stroke',
  'stroke-width',
  'preserveaspectratio',
  'preserveAspectRatio',
  'xmlns',
  'xlink:href',
  'href',
])
const SVG_MEANINGFUL_TAGS = new Set(['text', 'textpath', 'foreignobject', 'image', 'title', 'desc'])
const ANCHOR_TAGS = new Set([
  'a',
  'button',
  'input',
  'textarea',
  'select',
  'option',
  'label',
  'img',
  'picture',
  'source',
  'svg',
  'canvas',
  'video',
  'audio',
])
const LOW_VALUE_WRAPPER_TAGS = new Set(['div', 'span'])
const WRAPPER_COLLAPSE_SAFE_ATTRS = new Set([
  'class',
  'id',
  'role',
  'tabindex',
  'aria-hidden',
  'aria-controls',
  'aria-describedby',
  'aria-expanded',
  'aria-labelledby',
  'aria-owns',
])
const DROP_CLASS_TAGS = new Set(['div', 'span', 'label'])
const DROP_ATTR_NAMES = new Set([
  'style',
  'tabindex',
  'aria-controls',
  'aria-describedby',
  'aria-flowto',
  'aria-labelledby',
  'aria-live',
  'aria-owns',
  'aria-relevant',
])
const WRAPPER_TAGS = new Set([
  'faceplate-tracker',
  'activate-feature',
  'search-dynamic-id-cache-controller',
  'faceplate-loader',
  'faceplate-partial',
  'rpl-tooltip',
  'rpl-popper',
  'rpl-dropdown',
  'faceplate-screen-reader-content',
])
const DROP_ATTR_PREFIXES = ['data-', 'data-csnap', 'on']
const RECONSTRUCTION_KEEP_ATTRS = new Set([
  'style',
  'href',
  'src',
  'srcset',
  'alt',
  'loading',
  'title',
  'type',
  'name',
  'value',
  'placeholder',
  'autocomplete',
  'for',
  'id',
  'class',
  'role',
  'aria-label',
  'aria-hidden',
  'viewBox',
  'viewbox',
  'width',
  'height',
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'd',
  'points',
  'fill',
  'stroke',
  'stroke-width',
  'xmlns',
  'xlink:href',
])
const RECONSTRUCTION_MEANINGFUL_CONTAINER_ATTRS = new Set(['role', 'aria-label', 'aria-hidden'])
const SCENE_CLASS_TOKENS = ['board', 'piece', 'square', 'coord', 'coords', 'layer', 'overlay', 'highlight', 'ghost', 'arrow']
const SCENE_TAG_NAMES = new Set(['piece', 'square', 'coord', 'coords', 'cg-board', 'cg-container'])
const SEARCH_ROOT_CLASS_TOKENS = ['rnnxgb', 'a8sbwf', 'sdkep']
const SEARCH_DISCARD_CLASS_TOKENS = ['oMByyf', 'UbbAWe', 'XOUhue', 'plR5qb', 'Y5MKCd', 'FHRw9d']

type Node = {
  type: 'element' | 'text'
  tag?: string
  attrs?: Record<string, string>
  children?: Node[]
  text?: string
}

interface SceneAnalysis {
  sceneLike: boolean
  customElementCount: number
  absoluteOrTransformedCount: number
  meaningfulEmptyElementCount: number
  sceneTaggedElementCount: number
  textLength: number
  elementCount: number
}

interface ReconstructionSignals {
  mode: 'semantic' | 'scene-preserving'
  preservedEmptyScenePrimitiveCount: number
  preservedCustomElementCount: number
  preservedLayeredElementCount: number
}

const decodeEntities = (value: string) =>
  value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

const escapeAttr = (value: string) => escapeHtml(value).replace(/"/g, '&quot;')

const parseAttributes = (raw: string) => {
  const attrs: Record<string, string> = {}
  const re = /([:@a-zA-Z0-9_-]+)(?:\s*=\s*"([^"]*)")?/g
  let match: RegExpExecArray | null
  while ((match = re.exec(raw))) {
    attrs[match[1]] = decodeEntities(match[2] || '')
  }
  return attrs
}

const parseHtmlFragment = (html: string): Node[] => {
  const root: Node = { type: 'element', tag: '__root__', children: [] }
  const stack: Node[] = [root]
  const tokenRe = /<!--[^]*?-->|<\/?[a-zA-Z][^>]*>|[^<]+/g
  let match: RegExpExecArray | null

  while ((match = tokenRe.exec(html))) {
    const token = match[0]
    const current = stack[stack.length - 1]
    if (token.startsWith('<!--')) continue

    if (token.startsWith('</')) {
      const tag = token.slice(2, -1).trim().toLowerCase()
      while (stack.length > 1) {
        const top = stack.pop()!
        if (top.tag === tag) break
      }
      continue
    }

    if (token.startsWith('<')) {
      const selfClosing = token.endsWith('/>')
      const inner = token.slice(1, token.length - (selfClosing ? 2 : 1)).trim()
      const spaceIndex = inner.search(/\s/)
      const tag = (spaceIndex === -1 ? inner : inner.slice(0, spaceIndex)).toLowerCase()
      const attrRaw = spaceIndex === -1 ? '' : inner.slice(spaceIndex + 1)
      const node: Node = { type: 'element', tag, attrs: parseAttributes(attrRaw), children: [] }
      current.children!.push(node)
      if (!selfClosing && !VOID_TAGS.has(tag)) stack.push(node)
      continue
    }

    const text = decodeEntities(token.replace(/\s+/g, ' '))
    if (text.trim()) current.children!.push({ type: 'text', text })
  }

  return root.children || []
}

const isSvgNoise = (node: Node) => node.type === 'element' && (node.tag === 'defs' || node.tag === 'symbol' || node.tag === 'clipPath')

const countElementDescendants = (node: Node): number =>
  node.type !== 'element' ? 0 : (node.children || []).reduce((sum, child) => sum + (child.type === 'element' ? 1 : 0) + countElementDescendants(child), 0)

const collectSvgAttrPayload = (node: Node): number => {
  if (node.type !== 'element') return 0
  const own = Object.entries(node.attrs || {}).reduce((sum, [name, value]) => sum + name.length + value.length, 0)
  return own + (node.children || []).reduce((sum, child) => sum + collectSvgAttrPayload(child), 0)
}

const hasMeaningfulSvgContent = (node: Node): boolean => {
  if (node.type === 'text') return !!node.text?.trim()
  if (SVG_MEANINGFUL_TAGS.has(node.tag || '')) return true
  return (node.children || []).some((child) => hasMeaningfulSvgContent(child))
}

const findLongSvgGeometry = (node: Node): boolean => {
  if (node.type !== 'element') return false
  if (typeof node.attrs?.d === 'string' && node.attrs.d.length > 120) return true
  if (typeof node.attrs?.points === 'string' && node.attrs.points.length > 120) return true
  return (node.children || []).some((child) => findLongSvgGeometry(child))
}

const shouldCompactSvg = (node: Node, children: Node[]) => {
  if (hasMeaningfulSvgContent(node)) return false
  const directGraphicChildren = children.filter((child) => child.type === 'element' && !isSvgNoise(child))
  if (!directGraphicChildren.length) return false
  if (directGraphicChildren.some((child) => (child.type === 'element' ? SVG_MEANINGFUL_TAGS.has(child.tag || '') : false))) return false

  const descendantElementCount = directGraphicChildren.reduce((sum, child) => sum + 1 + countElementDescendants(child), 0)
  const attrPayload = collectSvgAttrPayload(node)
  return descendantElementCount > 3 || attrPayload > 280 || findLongSvgGeometry(node)
}

const buildCompactedSvgChildren = (children: Node[]): Node[] => {
  const hasRoundPrimitive = children.some(
    (child) => child.type === 'element' && (child.tag === 'circle' || child.tag === 'ellipse'),
  )
  if (hasRoundPrimitive) {
    return [{ type: 'element', tag: 'circle', attrs: { cx: '50%', cy: '50%', r: '38%' }, children: [] }]
  }

  const hasPolygonPrimitive = children.some(
    (child) => child.type === 'element' && (child.tag === 'polygon' || child.tag === 'polyline'),
  )
  if (hasPolygonPrimitive) {
    return [{ type: 'element', tag: 'polygon', attrs: { points: '50,16 84,84 16,84' }, children: [] }]
  }

  return [{ type: 'element', tag: 'rect', attrs: { x: '12%', y: '12%', width: '76%', height: '76%', rx: '18%' }, children: [] }]
}

const recordRemovedAttribute = (stats: { removedAttributeCounts: Record<string, number> }, name: string) => {
  stats.removedAttributeCounts[name] = (stats.removedAttributeCounts[name] || 0) + 1
}

const isCustomElementTag = (tag: string) => tag.includes('-')

const getStyleAttr = (attrs: Record<string, string> | undefined) => (attrs?.style || '').toLowerCase()

const hasSceneClass = (attrs: Record<string, string> | undefined) => {
  const className = (attrs?.class || '').toLowerCase()
  return SCENE_CLASS_TOKENS.some((token) => className.includes(token))
}

const hasSceneTag = (tag: string) => SCENE_TAG_NAMES.has(tag) || SCENE_CLASS_TOKENS.some((token) => tag.includes(token))

const hasScenePositioningStyle = (attrs: Record<string, string> | undefined) => {
  const style = getStyleAttr(attrs)
  return (
    style.includes('position:absolute') ||
    style.includes('position:relative') ||
    style.includes('position:fixed') ||
    style.includes('transform:') ||
    style.includes('translate(') ||
    style.includes('scale(') ||
    style.includes('rotate(') ||
    style.includes('matrix(') ||
    style.includes('top:') ||
    style.includes('left:') ||
    style.includes('right:') ||
    style.includes('bottom:') ||
    style.includes('width:') ||
    style.includes('height:') ||
    style.includes('aspect-ratio:') ||
    style.includes('background:') ||
    style.includes('background-color:') ||
    style.includes('border:') ||
    style.includes('border-color:') ||
    style.includes('opacity:') ||
    style.includes('z-index:')
  )
}

const countNonEmptyTextLength = (nodes: Node[]): number =>
  nodes.reduce((sum, node) => {
    if (node.type === 'text') return sum + ((node.text || '').replace(/\s+/g, ' ').trim().length || 0)
    return sum + countNonEmptyTextLength(node.children || [])
  }, 0)

const hasVisibleTextDescendant = (node: Node): boolean => {
  if (node.type === 'text') return !!node.text?.trim()
  return (node.children || []).some((child) => hasVisibleTextDescendant(child))
}

const isMeaningfulEmptySceneElement = (tag: string, attrs: Record<string, string> | undefined, children: Node[]) => {
  if (children.some((child) => hasVisibleTextDescendant(child))) return false
  if (children.some((child) => child.type === 'element')) return false
  return isCustomElementTag(tag) || hasSceneTag(tag) || hasScenePositioningStyle(attrs) || hasSceneClass(attrs)
}

const countSceneMarkedChildren = (children: Node[]): number =>
  children.reduce((sum, child) => {
    if (child.type !== 'element') return sum
    return sum + (isLikelySceneElement(child.tag || 'div', child.attrs, child.children || []) ? 1 : 0)
  }, 0)

const countRenderableElementChildren = (children: Node[]) =>
  children.reduce((sum, child) => sum + (child.type === 'element' ? 1 : 0), 0)

const isSingleScenePayloadWrapper = (node: Node) => {
  if (node.type !== 'element') return false
  const tag = node.tag || 'div'
  if (!LOW_VALUE_WRAPPER_TAGS.has(tag)) return false
  const children = node.children || []
  const elementChildren = children.filter((child) => child.type === 'element')
  if (elementChildren.length !== 1) return false
  if (hasVisibleTextDescendant(node)) return false
  const [child] = elementChildren
  return isLikelySceneElement(child.tag || 'div', child.attrs, child.children || [])
}

const countSceneCarrierChildren = (children: Node[]) =>
  children.reduce((sum, child) => {
    if (child.type !== 'element') return sum
    const directScene = isLikelySceneElement(child.tag || 'div', child.attrs, child.children || [])
    return sum + (directScene || isSingleScenePayloadWrapper(child) ? 1 : 0)
  }, 0)

const hasMultipleLayeredSceneChildren = (children: Node[]) => {
  const layeredChildren = children.filter(
    (child) =>
      child.type === 'element' &&
      (isLikelySceneElement(child.tag || 'div', child.attrs, child.children || []) || isSingleScenePayloadWrapper(child)) &&
      (hasScenePositioningStyle(child.attrs) ||
        (child.children || []).some(
          (grandchild) => grandchild.type === 'element' && hasScenePositioningStyle(grandchild.attrs),
        )),
  )
  return layeredChildren.length >= 2
}

const isLikelySceneElement = (tag: string, attrs: Record<string, string> | undefined, children: Node[]): boolean => {
  if (tag === 'svg') return true
  if (isCustomElementTag(tag)) return true
  if (hasSceneTag(tag)) return true
  if (hasScenePositioningStyle(attrs)) return true
  if (hasSceneClass(attrs)) return true
  if (isMeaningfulEmptySceneElement(tag, attrs, children)) return true
  return countSceneMarkedChildren(children) >= 2
}

const shouldPreserveSceneContainer = (
  tag: string,
  attrs: Record<string, string> | undefined,
  children: Node[],
  sceneLike: boolean,
) => {
  if (!sceneLike) return false
  if (!LOW_VALUE_WRAPPER_TAGS.has(tag) && !isCustomElementTag(tag)) return false
  if (hasSceneClass(attrs) || hasScenePositioningStyle(attrs)) return true
  if (countSceneCarrierChildren(children) >= 2) return true
  if (hasMultipleLayeredSceneChildren(children)) return true
  if (Object.keys(attrs || {}).length > 0 && countSceneCarrierChildren(children) >= 1) return true
  if (
    countSceneCarrierChildren(children) >= 1 &&
    children.length === 1 &&
    !hasVisibleTextDescendant({ type: 'element', tag, attrs, children })
  ) {
    return true
  }
  return (
    countRenderableElementChildren(children) >= 3 &&
    children.every(
      (child) =>
        child.type !== 'element' ||
        isLikelySceneElement(child.tag || 'div', child.attrs, child.children || []) ||
        isSingleScenePayloadWrapper(child),
    )
  )
}

const analyzeSceneLikeSubtree = (nodes: Node[]): SceneAnalysis => {
  let customElementCount = 0
  let absoluteOrTransformedCount = 0
  let meaningfulEmptyElementCount = 0
  let sceneTaggedElementCount = 0
  let elementCount = 0

  const visit = (node: Node) => {
    if (node.type !== 'element') return
    elementCount += 1
    const tag = node.tag || 'div'
    const children = node.children || []
    if (isCustomElementTag(tag)) customElementCount += 1
    if (hasSceneTag(tag) || hasSceneClass(node.attrs)) sceneTaggedElementCount += 1
    if (hasScenePositioningStyle(node.attrs)) absoluteOrTransformedCount += 1
    if (isMeaningfulEmptySceneElement(tag, node.attrs, children)) meaningfulEmptyElementCount += 1
    for (const child of children) visit(child)
  }

  for (const node of nodes) visit(node)

  const textLength = countNonEmptyTextLength(nodes)
  const lowTextDensity = textLength <= Math.max(24, elementCount * 2)
  const sceneLike =
    lowTextDensity &&
    (
      (customElementCount >= 1 && absoluteOrTransformedCount >= 3) ||
      (absoluteOrTransformedCount >= 6 && meaningfulEmptyElementCount >= 4) ||
      (sceneTaggedElementCount >= 2 && absoluteOrTransformedCount >= 2 && meaningfulEmptyElementCount >= 2) ||
      (meaningfulEmptyElementCount >= 6 && (customElementCount >= 1 || absoluteOrTransformedCount >= 4))
    )

  return {
    sceneLike,
    customElementCount,
    absoluteOrTransformedCount,
    meaningfulEmptyElementCount,
    sceneTaggedElementCount,
    textLength,
    elementCount,
  }
}

const hasOnlyCollapseSafeWrapperAttrs = (attrs: Record<string, string> | undefined) =>
  Object.keys(attrs || {}).every(
    (name) => WRAPPER_COLLAPSE_SAFE_ATTRS.has(name) || DROP_ATTR_PREFIXES.some((prefix) => name.startsWith(prefix)),
  )

const shouldDropAttribute = (tag: string, name: string, sceneLike: boolean, children: Node[], attrs: Record<string, string> | undefined) =>
  (sceneLike &&
    (name === 'style' || name === 'class') &&
    (isLikelySceneElement(tag, attrs, children) || shouldPreserveSceneContainer(tag, attrs, children, sceneLike)))
    ? false
    :
  DROP_ATTR_NAMES.has(name) || DROP_ATTR_PREFIXES.some((prefix) => name.startsWith(prefix)) || (name === 'class' && DROP_CLASS_TAGS.has(tag))

const canCollapseLowValueWrapper = (
  tag: string,
  attrs: Record<string, string> | undefined,
  children: Node[],
  sceneLike: boolean,
) => {
  if (!LOW_VALUE_WRAPPER_TAGS.has(tag)) return false
  if (children.length !== 1) return false
  if (sceneLike && (isLikelySceneElement(tag, attrs, children) || shouldPreserveSceneContainer(tag, attrs, children, sceneLike))) return false
  return hasOnlyCollapseSafeWrapperAttrs(attrs)
}

const countAnchors = (nodes: Node[]): number =>
  nodes.reduce((sum, node) => {
    if (node.type !== 'element') return sum
    const own = ANCHOR_TAGS.has(node.tag || '') ? 1 : 0
    return sum + own + countAnchors(node.children || [])
  }, 0)

const countWrapperNodes = (nodes: Node[]): number =>
  nodes.reduce((sum, node) => {
    if (node.type !== 'element') return sum
    const own = LOW_VALUE_WRAPPER_TAGS.has(node.tag || '') ? 1 : 0
    return sum + own + countWrapperNodes(node.children || [])
  }, 0)

const countTextNodes = (nodes: Node[]): number =>
  nodes.reduce((sum, node) => sum + (node.type === 'text' ? 1 : countTextNodes(node.children || [])), 0)

const round3 = (value: number) => Math.round(value * 1000) / 1000

const hasRenderableAnchorDescendant = (node: Node): boolean => {
  if (node.type !== 'element') return false
  if (ANCHOR_TAGS.has(node.tag || '')) return true
  return (node.children || []).some((child) => hasRenderableAnchorDescendant(child))
}

const shouldPromoteWrapper = (tag: string, attrs: Record<string, string>, children: Node[], sceneLike: boolean) => {
  if (!LOW_VALUE_WRAPPER_TAGS.has(tag)) return false
  if (sceneLike && (isLikelySceneElement(tag, attrs, children) || shouldPreserveSceneContainer(tag, attrs, children, sceneLike))) return false
  if (!children.length) return true
  if (!Object.keys(attrs).length) return true
  if (hasOnlyCollapseSafeWrapperAttrs(attrs)) return true
  return !ANCHOR_TAGS.has(tag) && hasRenderableAnchorDescendant({ type: 'element', tag, attrs, children })
}

const shouldKeepNonAnchorContainer = (tag: string, attrs: Record<string, string>, children: Node[]) => {
  if (ANCHOR_TAGS.has(tag)) return true
  if (!children.length) return false
  if (!Object.keys(attrs).length) return false
  return Object.keys(attrs).some((name) => RECONSTRUCTION_MEANINGFUL_CONTAINER_ATTRS.has(name))
}

const reconstructSvgNode = (node: Node): Node[] => {
  if (node.type === 'text') {
    const text = (node.text || '').replace(/\s+/g, ' ').trim()
    return text ? [{ type: 'text', text }] : []
  }

  const attrs = Object.fromEntries(
    Object.entries(node.attrs || {}).filter(([name, value]) => value !== '' && RECONSTRUCTION_KEEP_ATTRS.has(name)),
  )
  const children = (node.children || []).flatMap((child) => reconstructSvgNode(child))
  return [{ type: 'element', tag: node.tag || 'g', attrs, children }]
}

const reconstructNode = (node: Node, sceneLike: boolean): Node[] => {
  if (node.type === 'text') {
    const text = (node.text || '').replace(/\s+/g, ' ').trim()
    return text ? [{ type: 'text', text }] : []
  }

  const tag = node.tag || 'div'
  const attrs = Object.fromEntries(
    Object.entries(node.attrs || {}).filter(([name, value]) => value !== '' && RECONSTRUCTION_KEEP_ATTRS.has(name)),
  )
  if (tag === 'svg') return reconstructSvgNode({ ...node, attrs })
  const children = (node.children || []).flatMap((child) => reconstructNode(child, sceneLike))

  if (ANCHOR_TAGS.has(tag)) {
    return [{ type: 'element', tag, attrs, children }]
  }

  if (sceneLike && (isLikelySceneElement(tag, attrs, children) || shouldPreserveSceneContainer(tag, attrs, children, sceneLike))) {
    return [{ type: 'element', tag, attrs, children }]
  }
  if (shouldPromoteWrapper(tag, attrs, children, sceneLike)) return children
  if (!shouldKeepNonAnchorContainer(tag, attrs, children)) return children

  return [{ type: 'element', tag, attrs, children }]
}

const buildQualitySignals = (nodes: Node[], sceneAnalysis: SceneAnalysis) => {
  const nodeCount = countNodes(nodes)
  const anchorNodeCount = countAnchors(nodes)
  const wrapperNodeCount = countWrapperNodes(nodes)
  const textNodeCount = countTextNodes(nodes)
  const anchorDensity = nodeCount > 0 ? round3(anchorNodeCount / nodeCount) : 0
  const wrapperDensity = nodeCount > 0 ? round3(wrapperNodeCount / nodeCount) : 0
  const wrapperToAnchorRatio = anchorNodeCount > 0 ? round3(wrapperNodeCount / anchorNodeCount) : undefined

  let profile: 'anchor-dense' | 'balanced' | 'wrapper-heavy' | 'scene-like' = 'balanced'
  if (sceneAnalysis.sceneLike) profile = 'scene-like'
  else if (anchorNodeCount > 0 && wrapperNodeCount <= anchorNodeCount) profile = 'anchor-dense'
  else if (wrapperNodeCount >= Math.max(3, anchorNodeCount * 2)) profile = 'wrapper-heavy'

  return {
    anchorNodeCount,
    wrapperNodeCount,
    textNodeCount,
    anchorDensity,
    wrapperDensity,
    wrapperToAnchorRatio,
    profile,
  }
}

const isSearchLikeSemanticSubtree = (nodes: Node[]) => {
  let hasSearchField = false
  let hasSearchShell = false

  const visit = (node: Node) => {
    if (node.type !== 'element') return
    const tag = node.tag || 'div'
    const name = (node.attrs?.name || '').toLowerCase()
    const role = (node.attrs?.role || '').toLowerCase()
    const cls = (node.attrs?.class || '').toLowerCase()
    if ((tag === 'textarea' || tag === 'input') && (name === 'q' || role === 'combobox' || cls.includes('glfyf'))) {
      hasSearchField = true
    }
    if (SEARCH_ROOT_CLASS_TOKENS.some((token) => cls.includes(token)) || (tag === 'form' && role === 'search')) {
      hasSearchShell = true
    }
    for (const child of node.children || []) visit(child)
  }

  for (const node of nodes) visit(node)
  return hasSearchField && hasSearchShell
}

const shouldDiscardSearchSemanticNode = (node: Node) => {
  if (node.type !== 'element') return false
  const tag = node.tag || 'div'
  const cls = (node.attrs?.class || '').toLowerCase()
  const type = (node.attrs?.type || '').toLowerCase()
  const role = (node.attrs?.role || '').toLowerCase()
  const ariaLabel = (node.attrs?.['aria-label'] || '').toLowerCase()

  if (tag === 'script' || tag === 'style') return true
  if (tag === 'input' && type === 'file') return true
  if (SEARCH_DISCARD_CLASS_TOKENS.some((token) => cls.includes(token.toLowerCase()))) return true
  if (ariaLabel.includes('datei') || ariaLabel.includes('bilder hochladen')) return true
  if (ariaLabel.includes('dateianhang entfernen')) return true
  if ((node.children || []).some((child) => child.type === 'text' && (child.text || '').includes('KI‑Modus'))) return true
  if (role === 'menu' || role === 'menuitem' || role === 'dialog') return true
  return false
}

const pruneSearchSemanticNoise = (nodes: Node[]): Node[] => {
  const prune = (node: Node): Node[] => {
    if (node.type === 'text') return [{ ...node }]
    if (shouldDiscardSearchSemanticNode(node)) return []
    const children = (node.children || []).flatMap(prune)
    return [{ ...node, children }]
  }

  return nodes.flatMap(prune)
}

const normalizeNode = (
  node: Node,
  stats: {
    removedTagCounts: Record<string, number>
    removedAttributeCounts: Record<string, number>
    collapsedWrapperCount: number
    compactedSvgCount: number
  },
  sceneLike: boolean,
): Node[] => {
  if (node.type === 'text') {
    const text = (node.text || '').replace(/\s+/g, ' ').trim()
    return text ? [{ type: 'text', text }] : []
  }

  const tag = node.tag || 'div'
  if (NOISE_TAGS.has(tag) || isSvgNoise(node)) {
    stats.removedTagCounts[tag] = (stats.removedTagCounts[tag] || 0) + 1
    return []
  }

  const children = (node.children || []).flatMap((child) => normalizeNode(child, stats, sceneLike))

  if (WRAPPER_TAGS.has(tag)) {
    for (const name of Object.keys(node.attrs || {})) recordRemovedAttribute(stats, name)
    stats.collapsedWrapperCount += 1
    return children
  }

  const attrs: Record<string, string> = {}
  for (const [name, value] of Object.entries(node.attrs || {})) {
    if (shouldDropAttribute(tag, name, sceneLike, node.children || [], node.attrs)) {
      recordRemovedAttribute(stats, name)
      continue
    }
    attrs[name] = value
  }

  if (tag === 'svg') {
    const hasUsefulGraphicChild = children.some((child) => child.type === 'element' && !isSvgNoise(child))
    if (!hasUsefulGraphicChild) {
      stats.removedTagCounts[tag] = (stats.removedTagCounts[tag] || 0) + 1
      return []
    }

    if (shouldCompactSvg(node, children)) {
      stats.compactedSvgCount += 1
      const compactedAttrs = Object.fromEntries(Object.entries(attrs).filter(([name]) => SVG_COMPACT_KEEP_ATTRS.has(name)))
      return [{ type: 'element', tag, attrs: compactedAttrs, children: buildCompactedSvgChildren(children) }]
    }
  }

  if (canCollapseLowValueWrapper(tag, attrs, children, sceneLike)) {
    for (const name of Object.keys(attrs)) recordRemovedAttribute(stats, name)
    stats.collapsedWrapperCount += 1
    return children
  }

  if (LOW_VALUE_WRAPPER_TAGS.has(tag) && !children.length && hasOnlyCollapseSafeWrapperAttrs(attrs)) {
    if (sceneLike && (isLikelySceneElement(tag, attrs, children) || shouldPreserveSceneContainer(tag, attrs, children, sceneLike))) {
      return [{ type: 'element', tag, attrs, children }]
    }
    for (const name of Object.keys(attrs)) recordRemovedAttribute(stats, name)
    stats.collapsedWrapperCount += 1
    stats.removedTagCounts[tag] = (stats.removedTagCounts[tag] || 0) + 1
    return []
  }

  if (LOW_VALUE_WRAPPER_TAGS.has(tag) && !Object.keys(attrs).length && children.length === 1) {
    if (shouldPreserveSceneContainer(tag, attrs, children, sceneLike)) {
      return [{ type: 'element', tag, attrs, children }]
    }
    stats.collapsedWrapperCount += 1
    return children
  }

  if (!ANCHOR_TAGS.has(tag) && LOW_VALUE_WRAPPER_TAGS.has(tag) && !Object.keys(attrs).length && children.length) {
    if (shouldPreserveSceneContainer(tag, attrs, children, sceneLike)) {
      return [{ type: 'element', tag, attrs, children }]
    }
    return children
  }

  return [{ type: 'element', tag, attrs, children }]
}

const collectReconstructionSignals = (nodes: Node[], sceneLike: boolean): ReconstructionSignals => {
  let preservedEmptyScenePrimitiveCount = 0
  let preservedCustomElementCount = 0
  let preservedLayeredElementCount = 0

  const visit = (node: Node) => {
    if (node.type !== 'element') return
    const tag = node.tag || 'div'
    const children = node.children || []

    if (sceneLike && isMeaningfulEmptySceneElement(tag, node.attrs, children)) {
      preservedEmptyScenePrimitiveCount += 1
    }
    if (sceneLike && isCustomElementTag(tag)) {
      preservedCustomElementCount += 1
    }
    if (sceneLike && shouldPreserveSceneContainer(tag, node.attrs, children, sceneLike)) {
      preservedLayeredElementCount += 1
    }

    for (const child of children) visit(child)
  }

  for (const node of nodes) visit(node)

  return {
    mode: sceneLike ? 'scene-preserving' : 'semantic',
    preservedEmptyScenePrimitiveCount,
    preservedCustomElementCount,
    preservedLayeredElementCount,
  }
}

const serializeNodes = (nodes: Node[]): string =>
  nodes
    .map((node) => {
      if (node.type === 'text') return escapeHtml(node.text || '')
      const attrs = Object.entries(node.attrs || {})
        .filter(([, value]) => value !== '')
        .map(([name, value]) => `${name}="${escapeAttr(value)}"`)
        .join(' ')
      const open = attrs ? `<${node.tag} ${attrs}>` : `<${node.tag}>`
      if (VOID_TAGS.has(node.tag || '')) return open
      return `${open}${serializeNodes(node.children || [])}</${node.tag}>`
    })
    .join('')

const countNodes = (nodes: Node[]): number =>
  nodes.reduce((sum, node) => sum + 1 + (node.type === 'element' ? countNodes(node.children || []) : 0), 0)

const countTextLength = (nodes: Node[]): number =>
  nodes.reduce((sum, node) => sum + (node.type === 'text' ? (node.text || '').length : countTextLength(node.children || [])), 0)

export const normalizeTargetSubtree = (subtree: TargetSubtreeV0 | undefined): TargetCandidateSubtreeV0 | undefined => {
  if (!subtree?.html?.trim()) return undefined

  const parsed = parseHtmlFragment(subtree.html)
  const sceneAnalysis = analyzeSceneLikeSubtree(parsed)
  const stats = {
    removedTagCounts: {} as Record<string, number>,
    removedAttributeCounts: {} as Record<string, number>,
    collapsedWrapperCount: 0,
    compactedSvgCount: 0,
  }
  const normalized = parsed.flatMap((node) => normalizeNode(node, stats, sceneAnalysis.sceneLike))
  const reconstructed = normalized.flatMap((node) => reconstructNode(node, sceneAnalysis.sceneLike))
  const candidateNodesBase = reconstructed.length ? reconstructed : normalized
  const candidateNodes = !sceneAnalysis.sceneLike && isSearchLikeSemanticSubtree(candidateNodesBase)
    ? pruneSearchSemanticNoise(candidateNodesBase)
    : candidateNodesBase
  const html = serializeNodes(candidateNodes)
  const reconstruction = collectReconstructionSignals(candidateNodes, sceneAnalysis.sceneLike)
  const quality = buildQualitySignals(candidateNodes, sceneAnalysis)
  const warnings: string[] = []
  if (stats.collapsedWrapperCount > 0) warnings.push(`target-candidate-collapsed-wrappers:${stats.collapsedWrapperCount}`)
  if (stats.compactedSvgCount > 0) warnings.push(`target-candidate-compacted-svgs:${stats.compactedSvgCount}`)
  if (Object.keys(stats.removedTagCounts).length > 0) warnings.push('target-candidate-noise-tags-removed')
  if (Object.keys(stats.removedAttributeCounts).length > 0) warnings.push('target-candidate-noise-attributes-removed')
  if (sceneAnalysis.sceneLike) warnings.push('target-candidate-scene-like-subtree')
  warnings.push(`target-candidate-reconstruction:${reconstruction.mode}`)
  warnings.push(`target-candidate-profile:${quality.profile}`)

  return {
    html,
    source: reconstructed.length ? 'reconstructed-subtree' : 'normalized-subtree',
    removedTagCounts: stats.removedTagCounts,
    removedAttributeCounts: stats.removedAttributeCounts,
    collapsedWrapperCount: stats.collapsedWrapperCount,
    compactedSvgCount: stats.compactedSvgCount,
    nodeCount: countNodes(candidateNodes),
    textLength: countTextLength(candidateNodes),
    reconstruction,
    quality,
    warnings: warnings.length ? warnings : undefined,
  }
}
