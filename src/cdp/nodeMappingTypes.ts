export interface TargetAttributeHint {
  name: string
  value: string
}

export interface TargetAncestryNodeSummary {
  tagName: string
  id?: string
  classList: string[]
  siblingIndex?: number
}

export interface TargetShadowContext {
  insideShadowRoot: boolean
  shadowDepth: number
  hostChain: string[]
}

export type TargetClass = 'semantic-leaf' | 'semantic-shell' | 'interactive-composite' | 'render-scene' | 'noisy-container'
export type TargetSubtype =
  | 'search-like'
  | 'toolbar-like'
  | 'card-like'
  | 'form-like'
  | 'board-like'
  | 'chart-like'
  | 'map-like'
  | 'generic'

export interface TargetFingerprint {
  stableSelector?: string
  selectedSelector?: string
  originalStableSelector?: string
  originalSelectedSelector?: string
  promotedStableSelector?: string
  promotedSelectedSelector?: string
  promotionReason?: string
  promotionPath?: string[]
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
  attributeHints: TargetAttributeHint[]
  ancestry: TargetAncestryNodeSummary[]
  shadowContext?: TargetShadowContext
  targetClassHint?: TargetClass
  targetSubtypeHint?: TargetSubtype
  targetClassReasons?: string[]
}

export type NodeMappingStrategy = 'runtime-structural' | 'dom-traversal' | 'selector-fallback' | 'unresolved'

export interface NodeMappingNodeIdentity {
  nodeId?: number
  backendNodeId?: number
  objectId?: string
  snapshotIndex?: number
}

export interface NodeMappingResult {
  resolved: boolean
  confidence: number
  strategy: NodeMappingStrategy
  evidence: string[]
  warnings?: string[]
  candidateCount?: number
  node?: NodeMappingNodeIdentity
  diagnostics?: {
    snapshotHints?: string[]
    strategyAttempts?: Array<{
      strategy: NodeMappingStrategy
      resolved: boolean
      confidence: number
      candidateCount?: number
      warnings?: string[]
    }>
  }
}
