import type { TargetSubtreeV0 } from './types'

export interface TargetCandidateSubtreeV0 {
  html: string
  source: 'normalized-subtree'
  removedTagCounts: Record<string, number>
  removedAttributeCounts: Record<string, number>
  collapsedWrapperCount: number
  nodeCount: number
  textLength: number
  warnings?: string[]
}

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'])
const NOISE_TAGS = new Set(['script', 'style', 'template', 'slot'])
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
const DROP_ATTR_PREFIXES = ['data-csnap']
const DROP_ATTRS = new Set(['style'])

type Node = {
  type: 'element' | 'text'
  tag?: string
  attrs?: Record<string, string>
  children?: Node[]
  text?: string
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

const normalizeNode = (
  node: Node,
  stats: {
    removedTagCounts: Record<string, number>
    removedAttributeCounts: Record<string, number>
    collapsedWrapperCount: number
  },
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

  const children = (node.children || []).flatMap((child) => normalizeNode(child, stats))

  if (WRAPPER_TAGS.has(tag)) {
    stats.collapsedWrapperCount += 1
    return children
  }

  const attrs: Record<string, string> = {}
  for (const [name, value] of Object.entries(node.attrs || {})) {
    if (DROP_ATTRS.has(name) || DROP_ATTR_PREFIXES.some((prefix) => name.startsWith(prefix))) {
      stats.removedAttributeCounts[name] = (stats.removedAttributeCounts[name] || 0) + 1
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
  }

  if ((tag === 'div' || tag === 'span') && !Object.keys(attrs).length && children.length === 1) {
    stats.collapsedWrapperCount += 1
    return children
  }

  return [{ type: 'element', tag, attrs, children }]
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
  const stats = {
    removedTagCounts: {} as Record<string, number>,
    removedAttributeCounts: {} as Record<string, number>,
    collapsedWrapperCount: 0,
  }
  const normalized = parsed.flatMap((node) => normalizeNode(node, stats))
  const html = serializeNodes(normalized)
  const warnings: string[] = []
  if (stats.collapsedWrapperCount > 0) warnings.push(`target-candidate-collapsed-wrappers:${stats.collapsedWrapperCount}`)
  if (Object.keys(stats.removedTagCounts).length > 0) warnings.push('target-candidate-noise-tags-removed')
  if (Object.keys(stats.removedAttributeCounts).length > 0) warnings.push('target-candidate-noise-attributes-removed')

  return {
    html,
    source: 'normalized-subtree',
    removedTagCounts: stats.removedTagCounts,
    removedAttributeCounts: stats.removedAttributeCounts,
    collapsedWrapperCount: stats.collapsedWrapperCount,
    nodeCount: countNodes(normalized),
    textLength: countTextLength(normalized),
    warnings: warnings.length ? warnings : undefined,
  }
}
