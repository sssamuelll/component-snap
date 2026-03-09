import type { CDPClient } from './client'
import type { NodeMappingResult, TargetFingerprint } from './nodeMappingTypes'

type DOMGetDocumentResponse = {
  root?: DOMNode
}

type DOMNode = {
  nodeId?: number
  backendNodeId?: number
  nodeName?: string
  attributes?: string[]
  childNodeCount?: number
  children?: DOMNode[]
  shadowRoots?: DOMNode[]
}

type TraversalCandidate = {
  node: DOMNode
  score: number
  penaltyPoints: number
  evidence: string[]
  siblingIndex?: number
  ancestry: DOMNode[]
  shadowDepth: number
}

const normalize = (value: string | undefined) => String(value || '').toLowerCase().replace(/\s+/g, ' ').trim()

const toAttributeMap = (attributes: string[] | undefined) => {
  const map = new Map<string, string>()
  if (!attributes || attributes.length < 2) return map
  for (let i = 0; i + 1 < attributes.length; i += 2) {
    const name = normalize(attributes[i])
    const value = normalize(attributes[i + 1])
    if (name) map.set(name, value)
  }
  return map
}

const classTokens = (className: string | undefined) =>
  (className || '')
    .split(/\s+/)
    .map((token) => normalize(token))
    .filter(Boolean)

type TraversalConfidenceInput = {
  score: number
  scoreDelta: number
  penaltyPoints: number
  ambiguousCount: number
}

const scoreToConfidence = ({ score, scoreDelta, penaltyPoints, ambiguousCount }: TraversalConfidenceInput) => {
  const base = Math.max(0.16, Math.min(0.93, score / 100))
  const marginBonus = Math.max(0, Math.min(0.08, scoreDelta / 30))
  const driftPenalty = Math.max(0, Math.min(0.28, penaltyPoints / 35))
  const ambiguityPenalty = ambiguousCount > 1 ? Math.min(0.2, (ambiguousCount - 1) * 0.06) : 0
  return Math.max(0.05, Math.min(1, base + marginBonus - driftPenalty - ambiguityPenalty))
}

const SCORE_WEIGHTS = {
  tag: 24,
  id: 32,
  classPerMatch: 4,
  classMax: 18,
  siblingIndex: 7,
  childExact: 5,
  childNear: 2,
  attrPerMatch: 4,
  attrMax: 14,
  ancestryTag: 3,
  ancestryId: 4,
  ancestryClass: 1,
  ancestryMax: 18,
  shadowInsideMatch: 3,
  shadowDepthExact: 5,
  shadowDepthNear: 1,
  shadowHostPerMatch: 3,
  shadowHostMax: 8,
}

const SCORE_PENALTIES = {
  childCountDrift: 4,
  shadowInsideMismatch: 10,
  shadowDepthDrift: 6,
  shadowHostMismatch: 5,
}

const SCORE_THRESHOLDS = {
  minResolvedScore: 32,
  ambiguousDelta: 9,
  topCandidateWindow: 9,
}

const scoreCandidate = (
  fingerprint: TargetFingerprint,
  node: DOMNode,
  siblingIndex: number | undefined,
  ancestry: DOMNode[],
  shadowDepth: number,
): TraversalCandidate => {
  const attrs = toAttributeMap(node.attributes)
  const evidence: string[] = []
  let score = 0
  let penaltyPoints = 0

  const nodeTag = normalize(node.nodeName)
  if (nodeTag && nodeTag === normalize(fingerprint.tagName)) {
    score += SCORE_WEIGHTS.tag
    evidence.push('tag match')
  }

  const fpId = normalize(fingerprint.id)
  const nodeId = normalize(attrs.get('id'))
  if (fpId && nodeId && fpId === nodeId) {
    score += SCORE_WEIGHTS.id
    evidence.push('id match')
  }

  const fpClasses = new Set(fingerprint.classList.map((token) => normalize(token)).filter(Boolean))
  if (fpClasses.size > 0) {
    const nodeClasses = new Set(classTokens(attrs.get('class')))
    let classMatches = 0
    fpClasses.forEach((token) => {
      if (nodeClasses.has(token)) classMatches += 1
    })
    if (classMatches > 0) {
      score += Math.min(SCORE_WEIGHTS.classMax, classMatches * SCORE_WEIGHTS.classPerMatch)
      evidence.push(`class overlap: ${classMatches}`)
    }
  }

  if (typeof fingerprint.siblingIndex === 'number' && typeof siblingIndex === 'number' && fingerprint.siblingIndex === siblingIndex) {
    score += SCORE_WEIGHTS.siblingIndex
    evidence.push('sibling index match')
  }

  if (typeof fingerprint.childCount === 'number') {
    const nodeChildCount = typeof node.childNodeCount === 'number' ? node.childNodeCount : node.children?.length || 0
    if (nodeChildCount === fingerprint.childCount) {
      score += SCORE_WEIGHTS.childExact
      evidence.push('child count match')
    } else if (Math.abs(nodeChildCount - fingerprint.childCount) <= 2) {
      score += SCORE_WEIGHTS.childNear
      evidence.push('child count near')
    } else {
      score -= SCORE_PENALTIES.childCountDrift
      penaltyPoints += SCORE_PENALTIES.childCountDrift
      evidence.push('child count drift detected')
    }
  }

  if (fingerprint.attributeHints.length > 0) {
    let attrMatches = 0
    for (const hint of fingerprint.attributeHints) {
      const actual = attrs.get(normalize(hint.name))
      if (actual && actual === normalize(hint.value)) attrMatches += 1
    }
    if (attrMatches > 0) {
      score += Math.min(SCORE_WEIGHTS.attrMax, attrMatches * SCORE_WEIGHTS.attrPerMatch)
      evidence.push(`attribute hints match: ${attrMatches}`)
    }
  }

  if (fingerprint.ancestry.length > 0 && ancestry.length > 0) {
    let ancestryScore = 0
    for (let i = 0; i < Math.min(5, fingerprint.ancestry.length, ancestry.length); i += 1) {
      const expected = fingerprint.ancestry[i]
      const actual = ancestry[i]
      const actualAttrs = toAttributeMap(actual.attributes)
      if (normalize(expected.tagName) === normalize(actual.nodeName)) ancestryScore += SCORE_WEIGHTS.ancestryTag
      if (expected.id && normalize(expected.id) === normalize(actualAttrs.get('id'))) ancestryScore += SCORE_WEIGHTS.ancestryId
      const expectedClasses = new Set((expected.classList || []).map((token) => normalize(token)).filter(Boolean))
      if (expectedClasses.size > 0) {
        const actualClasses = new Set(classTokens(actualAttrs.get('class')))
        expectedClasses.forEach((token) => {
          if (actualClasses.has(token)) ancestryScore += SCORE_WEIGHTS.ancestryClass
        })
      }
    }
    if (ancestryScore > 0) {
      score += Math.min(SCORE_WEIGHTS.ancestryMax, ancestryScore)
      evidence.push('ancestry alignment')
    }
  }

  if (fingerprint.shadowContext) {
    const expectedShadow = fingerprint.shadowContext
    const isInsideShadow = shadowDepth > 0
    if (expectedShadow.insideShadowRoot === isInsideShadow) {
      score += SCORE_WEIGHTS.shadowInsideMatch
    } else {
      score -= SCORE_PENALTIES.shadowInsideMismatch
      penaltyPoints += SCORE_PENALTIES.shadowInsideMismatch
      evidence.push('shadow root context mismatch')
    }

    if (expectedShadow.insideShadowRoot && isInsideShadow) {
      const depthDelta = Math.abs(expectedShadow.shadowDepth - shadowDepth)
      if (depthDelta === 0) {
        score += SCORE_WEIGHTS.shadowDepthExact
        evidence.push('shadow depth match')
      } else if (depthDelta === 1) {
        score += SCORE_WEIGHTS.shadowDepthNear
        evidence.push('shadow depth near')
      } else {
        score -= SCORE_PENALTIES.shadowDepthDrift
        penaltyPoints += SCORE_PENALTIES.shadowDepthDrift
        evidence.push('shadow depth drift detected')
      }

      if (expectedShadow.hostChain.length > 0) {
        const ancestryDescriptors = ancestry
          .map((entry) => {
            const entryAttrs = toAttributeMap(entry.attributes)
            const entryId = normalize(entryAttrs.get('id'))
            const tag = normalize(entry.nodeName)
            return `${tag}${entryId ? `#${entryId}` : ''}`
          })
          .filter(Boolean)

        let hostMatches = 0
        for (const expectedHost of expectedShadow.hostChain.map((host) => normalize(host))) {
          if (ancestryDescriptors.some((descriptor) => descriptor.includes(expectedHost))) hostMatches += 1
        }

        if (hostMatches > 0) {
          score += Math.min(SCORE_WEIGHTS.shadowHostMax, hostMatches * SCORE_WEIGHTS.shadowHostPerMatch)
          evidence.push(`shadow host chain overlap: ${hostMatches}`)
        } else {
          score -= SCORE_PENALTIES.shadowHostMismatch
          penaltyPoints += SCORE_PENALTIES.shadowHostMismatch
          evidence.push('shadow host chain mismatch')
        }
      }
    }
  }

  return { node, score, penaltyPoints, evidence, siblingIndex, ancestry, shadowDepth }
}

const collectCandidates = (fingerprint: TargetFingerprint, root: DOMNode) => {
  const candidates: TraversalCandidate[] = []

  const walk = (node: DOMNode, ancestry: DOMNode[], siblingIndex?: number, shadowDepth = 0) => {
    const scored = scoreCandidate(fingerprint, node, siblingIndex, ancestry, shadowDepth)
    const nodeTag = normalize(node.nodeName)
    if (scored.score > 0 && typeof node.nodeId === 'number' && nodeTag && !nodeTag.startsWith('#')) candidates.push(scored)

    const nextAncestry = [node, ...ancestry].slice(0, 8)
    const children = node.children || []
    for (let i = 0; i < children.length; i += 1) {
      walk(children[i], nextAncestry, i, shadowDepth)
    }

    const shadowRoots = node.shadowRoots || []
    for (const shadowRoot of shadowRoots) {
      walk(shadowRoot, nextAncestry, undefined, shadowDepth + 1)
    }
  }

  walk(root, [])
  return candidates.sort((a, b) => b.score - a.score)
}

export const resolveNodeByDomTraversal = async (
  client: CDPClient,
  fingerprint: TargetFingerprint,
): Promise<NodeMappingResult> => {
  const response = await client.send<DOMGetDocumentResponse>('DOM.getDocument', { depth: -1, pierce: true })
  if (!response.root) {
    return {
      resolved: false,
      confidence: 0,
      strategy: 'unresolved',
      evidence: [],
      warnings: ['dom traversal failed: DOM.getDocument returned no root'],
    }
  }

  const scored = collectCandidates(fingerprint, response.root)
  if (!scored.length) {
    return {
      resolved: false,
      confidence: 0,
      strategy: 'unresolved',
      evidence: ['dom traversal found no candidates with positive score'],
      warnings: ['dom traversal did not find a matching node'],
      candidateCount: 0,
    }
  }

  const best = scored[0]
  const second = scored[1]
  const scoreDelta = second ? best.score - second.score : best.score
  const ambiguousCount = scored.filter((candidate) => best.score - candidate.score < SCORE_THRESHOLDS.topCandidateWindow).length
  const ambiguous = !!second && scoreDelta < SCORE_THRESHOLDS.ambiguousDelta
  const confidence = scoreToConfidence({
    score: best.score,
    scoreDelta,
    penaltyPoints: best.penaltyPoints,
    ambiguousCount,
  })
  const topCandidatesSummary = scored
    .slice(0, 3)
    .map((candidate) => {
      const attrs = toAttributeMap(candidate.node.attributes)
      const id = attrs.get('id')
      return `${normalize(candidate.node.nodeName)}${id ? `#${id}` : ''}:${candidate.score}(-${candidate.penaltyPoints})`
    })
    .join(', ')

  if (best.score < SCORE_THRESHOLDS.minResolvedScore || typeof best.node.nodeId !== 'number') {
    return {
      resolved: false,
      confidence,
      strategy: 'unresolved',
      evidence: [
        'best dom-traversal score below threshold',
        `score delta to 2nd: ${scoreDelta}`,
        ...best.evidence.slice(0, 8),
        `top dom-traversal candidates (score/penalty): ${topCandidatesSummary}`,
      ],
      warnings: ['dom traversal found candidates but none reached confidence threshold'],
      candidateCount: scored.length,
    }
  }

  return {
    resolved: true,
    confidence,
    strategy: 'dom-traversal',
    evidence: [
      'dom traversal matched fingerprint signals',
      `score delta to 2nd: ${scoreDelta}`,
      ...best.evidence.slice(0, 8),
      `top dom-traversal candidates (score/penalty): ${topCandidatesSummary}`,
    ],
    candidateCount: scored.length,
    node: {
      nodeId: best.node.nodeId,
      backendNodeId: best.node.backendNodeId,
    },
    warnings:
      ambiguous || ambiguousCount > 1
        ? [`dom traversal found close competing candidates (${ambiguousCount} within ${SCORE_THRESHOLDS.topCandidateWindow} points)`]
        : undefined,
  }
}
