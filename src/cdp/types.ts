export type CaptureBackend = 'extension' | 'cdp'
import type { NodeMappingResult, TargetFingerprint } from './nodeMappingTypes'

export interface CaptureBoundingBox {
  x: number
  y: number
  width: number
  height: number
  dpr: number
}

export interface CaptureSeed {
  requestId: string
  tabId?: number
  pageUrl: string
  pageTitle: string
  selectedSelector?: string
  stableSelector?: string
  boundingBox?: CaptureBoundingBox
  elementHint?: {
    tagName?: string
    id?: string
    classList?: string[]
    textPreview?: string
    kind?: string
  }
  targetFingerprint?: TargetFingerprint
  actionTraceEvents?: ActionTraceEventV0[]
  mutationTraceEvents?: MutationTraceEventV0[]
}

export interface CaptureBundleV0 {
  version: '0'
  captureId: string
  createdAt: string
  backend: 'cdp'
  seed: CaptureSeed
  page: {
    url: string
    title: string
    viewport: { width: number; height: number }
    scroll: { x: number; y: number }
    dpr: number
    userAgent?: string
    colorScheme?: 'light' | 'dark' | 'unknown'
    language?: string
  }
  screenshot: {
    fullPageDataUrl?: string
    clipDataUrl?: string
    clipRect?: CaptureBoundingBox
  }
  domSnapshot: {
    raw?: unknown
    stats?: {
      documents: number
      nodes: number
      layouts?: number
    }
  }
  runtimeHints: {
    shadowDomPresent?: boolean
    iframePresent?: boolean
    canvasPresent?: boolean
    webglPresent?: boolean
  }
  shadowTopology?: ShadowTopologyV0
  targetSubtree?: TargetSubtreeV0
  candidateSubtree?: TargetCandidateSubtreeV0
  nodeMapping?: NodeMappingResult
  cssGraph?: MatchedStyleGraphV0
  resourceGraph?: ResourceGraphV0
  replayCapsule?: ReplayCapsuleV0
  fidelity?: FidelityScoringV0
  debug?: {
    warnings: string[]
  }
}

export type ActionTraceEventTypeV0 = 'click' | 'hover' | 'input' | 'focus' | 'keyboard'

export interface ActionTraceEventV0 {
  type: ActionTraceEventTypeV0
  atMs: number
  selector?: string
  tagName?: string
  text?: string
  key?: string
  code?: string
  value?: string
}

export type MutationTraceTypeV0 = 'attributes' | 'childList' | 'characterData'

export interface MutationTraceActionRefV0 {
  type: ActionTraceEventTypeV0
  atMs: number
}

export interface MutationTraceEventV0 {
  type: MutationTraceTypeV0
  atMs: number
  selector?: string
  tagName?: string
  attributeName?: string
  addedNodes?: number
  removedNodes?: number
  addedTagNames?: string[]
  removedTagNames?: string[]
  valuePreview?: string
  actionRef?: MutationTraceActionRefV0
}

export type ReplayTimelineEventKindV0 = 'action-trace' | 'mutation'

export interface ReplayActionTraceTimelineEventV0 {
  kind: 'action-trace'
  atMs: number
  action: ActionTraceEventV0
  targetNodeId?: number
  label?: string
  payload?: Record<string, unknown>
}

export interface ReplayMutationTimelineEventV0 {
  kind: 'mutation'
  atMs: number
  mutation: MutationTraceEventV0
  targetNodeId?: number
  label?: string
  payload?: Record<string, unknown>
}

export type ReplayTimelineEventV0 = ReplayActionTraceTimelineEventV0 | ReplayMutationTimelineEventV0

export interface ReplayTimelineV0 {
  events: ReplayTimelineEventV0[]
}

export interface ReplayCapsuleV0 {
  version: '0'
  mode: 'snapshot-first'
  createdAt: string
  snapshot: {
    page: CaptureBundleV0['page']
    screenshot: CaptureBundleV0['screenshot']
    domSnapshot: CaptureBundleV0['domSnapshot']
    nodeMapping?: NodeMappingResult
    cssGraph?: MatchedStyleGraphV0
    shadowTopology?: ShadowTopologyV0
    targetSubtree?: TargetSubtreeV0
    candidateSubtree?: TargetCandidateSubtreeV0
    resourceGraph?: ResourceGraphV0
  }
  timeline: ReplayTimelineV0
  diagnostics?: {
    missingArtifacts?: string[]
    timelineEventCount?: number
    warnings?: string[]
    fidelity?: FidelityScoringV0
  }
}

export interface TargetSubtreeV0 {
  source: 'runtime-object' | 'selector-fallback'
  html: string
  nodeCount: number
  elementCount: number
  textNodeCount: number
  textLength: number
  maxDepth: number
  warnings?: string[]
}

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

export interface FidelityDimensionScoreV0 {
  score: number
  confidence: number
  evidence: string[]
  warnings?: string[]
}

export interface PixelDiffMetricsV0 {
  mismatchPixels: number
  mismatchRatio: number
  dimensionsMatch: boolean
  comparedDimensions: {
    width: number
    height: number
  }
  baselineDimensions: {
    width: number
    height: number
  }
  candidateDimensions: {
    width: number
    height: number
  }
}

export interface FidelityScoringV0 {
  version: '0'
  computedAt: string
  overall: {
    score: number
    confidence: number
  }
  dimensions: {
    visual: FidelityDimensionScoreV0
    interaction: FidelityDimensionScoreV0
    assetCompleteness: FidelityDimensionScoreV0
    structuralConfidence: FidelityDimensionScoreV0
  }
  pixelDiff?: PixelDiffMetricsV0
  warnings: string[]
  notes: string[]
}

export interface ShadowTopologySheetV0 {
  index: number
  href?: string
  disabled?: boolean
  mediaText?: string
  title?: string
  ruleCount?: number
  constructed?: boolean
}

export interface ShadowTopologyHostV0 {
  nodeId?: number
  backendNodeId?: number
  nodeName?: string
  tagName?: string
  id?: string
  classList?: string[]
}

export interface ShadowTopologyRootV0 {
  mode: 'open' | 'closed' | 'unknown'
  depth: number
  host?: ShadowTopologyHostV0
  adoptedStyleSheets?: ShadowTopologySheetV0[]
}

export interface ShadowTopologyV0 {
  roots: ShadowTopologyRootV0[]
  diagnostics?: {
    totalShadowRoots?: number
    openShadowRootCount?: number
    closedShadowRootCount?: number
    unknownShadowRootCount?: number
    maxShadowDepth?: number
    adoptedStyleSheetRootCount?: number
    adoptedStyleSheetCount?: number
    warnings?: string[]
  }
}

export interface RuntimeEnvironmentCapture {
  url: string
  title: string
  viewport: { width: number; height: number }
  scroll: { x: number; y: number }
  dpr: number
  userAgent: string
  colorScheme: 'light' | 'dark' | 'unknown'
  language?: string
  runtimeHints: CaptureBundleV0['runtimeHints']
}

export interface StyleDeclarationV0 {
  name: string
  value: string
  important?: boolean
  disabled?: boolean
  implicit?: boolean
}

export interface StyleDeclarationBlockV0 {
  declarations: StyleDeclarationV0[]
}

export interface MatchedRuleV0 {
  origin?: 'regular' | 'user-agent' | 'injected' | 'inspector' | 'inline'
  selectorList: string[]
  stylesheet?: {
    styleSheetId?: string
    sourceURL?: string
    isInline?: boolean
    startLine?: number
    startColumn?: number
  }
  media?: string[]
  supports?: string[]
  layer?: string
  declarations: StyleDeclarationV0[]
}

export interface MatchedStyleGraphV0 {
  target: {
    nodeId?: number
    backendNodeId?: number
    selector?: string
  }
  inline?: StyleDeclarationBlockV0
  matchedRules: MatchedRuleV0[]
  computed?: Array<{ name: string; value: string }>
  customProperties?: Array<{ name: string; value: string; source?: string }>
  keyframes?: string[]
  diagnostics?: {
    stylesheetCount?: number
    ruleCount?: number
    computedCount?: number
    inlineDeclarationCount?: number
    customPropertyCount?: number
    customPropertyReferenceCount?: number
    customPropertyReferenceOnlyCount?: number
    unresolvedCustomPropertyReferenceCount?: number
    keyframeCount?: number
    matchedRuleWithOriginCount?: number
    matchedRuleWithoutOriginCount?: number
    matchedRuleWithoutSelectorCount?: number
    matchedRuleUserAgentCount?: number
    matchedRuleWithIncompleteStylesheetMetadataCount?: number
    warnings?: string[]
  }
}

export interface ResourceGraphNodeV0 {
  id: string
  kind: 'document' | 'origin' | 'stylesheet' | 'font' | 'image' | 'script' | 'svg-reference' | 'other'
  label?: string
  url?: string
  ref?: string
  source?: 'capture' | 'cssGraph' | 'shadowTopology' | 'domSnapshot'
  inline?: boolean
}

export interface ResourceGraphEdgeV0 {
  from: string
  to: string
  kind: 'contains' | 'references' | 'depends-on'
  reason?: string
}

export interface ResourceGraphV0 {
  nodes: ResourceGraphNodeV0[]
  edges: ResourceGraphEdgeV0[]
  bundler?: {
    mode: 'light'
    assets: Array<{
      nodeId: string
      kind: ResourceGraphNodeV0['kind']
      url?: string
      ref?: string
      fetchMode: 'network' | 'inline-data' | 'unresolved'
      required?: boolean
    }>
  }
  diagnostics?: {
    nodeCount?: number
    edgeCount?: number
    resourceNodeCount?: number
    stylesheetCount?: number
    fontCount?: number
    imageCount?: number
    scriptCount?: number
    svgReferenceCount?: number
    otherCount?: number
    bundleAssetCount?: number
    unresolvedBundleAssetCount?: number
    warnings?: string[]
  }
}
