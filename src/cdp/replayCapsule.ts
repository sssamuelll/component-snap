import type { CaptureBundleV0, ReplayCapsuleV0, ReplayTimelineEventV0 } from './types'

export interface BuildReplayCapsuleInput {
  createdAt: string
  page: CaptureBundleV0['page']
  screenshot: CaptureBundleV0['screenshot']
  domSnapshot: CaptureBundleV0['domSnapshot']
  nodeMapping?: CaptureBundleV0['nodeMapping']
  cssGraph?: CaptureBundleV0['cssGraph']
  shadowTopology?: CaptureBundleV0['shadowTopology']
  targetSubtree?: CaptureBundleV0['targetSubtree']
  candidateSubtree?: CaptureBundleV0['candidateSubtree']
  resourceGraph?: CaptureBundleV0['resourceGraph']
  timelineEvents?: ReplayTimelineEventV0[]
}

export interface ReplayCapsuleBuildResult {
  replayCapsule: ReplayCapsuleV0
  warnings: string[]
}

const hasAnyScreenshot = (screenshot: CaptureBundleV0['screenshot']) =>
  !!(screenshot?.fullPageDataUrl || screenshot?.clipDataUrl)

const hasDomSnapshot = (domSnapshot: CaptureBundleV0['domSnapshot']) => typeof domSnapshot?.raw !== 'undefined'

export const buildReplayCapsule = (input: BuildReplayCapsuleInput): ReplayCapsuleBuildResult => {
  const warnings: string[] = []
  const missingArtifacts: string[] = []
  const timelineEvents = Array.isArray(input.timelineEvents) ? input.timelineEvents : []

  if (!hasAnyScreenshot(input.screenshot)) missingArtifacts.push('screenshot')
  if (!hasDomSnapshot(input.domSnapshot)) missingArtifacts.push('domSnapshot')
  if (!input.nodeMapping) missingArtifacts.push('nodeMapping')
  if (!input.cssGraph) missingArtifacts.push('cssGraph')
  if (!input.shadowTopology) missingArtifacts.push('shadowTopology')
  if (!input.targetSubtree) missingArtifacts.push('targetSubtree')
  if (!input.candidateSubtree) missingArtifacts.push('candidateSubtree')
  if (!input.resourceGraph) missingArtifacts.push('resourceGraph')

  if (missingArtifacts.length > 0) warnings.push(`replay-capsule-missing-artifacts:${missingArtifacts.join(',')}`)
  if (timelineEvents.length === 0) warnings.push('replay-capsule-empty-timeline')

  return {
    replayCapsule: {
      version: '0',
      mode: 'snapshot-first',
      createdAt: input.createdAt,
      snapshot: {
        page: input.page,
        screenshot: input.screenshot,
        domSnapshot: input.domSnapshot,
        nodeMapping: input.nodeMapping,
        cssGraph: input.cssGraph,
        shadowTopology: input.shadowTopology,
        targetSubtree: input.targetSubtree,
        candidateSubtree: input.candidateSubtree,
        resourceGraph: input.resourceGraph,
      },
      timeline: {
        events: timelineEvents,
      },
      diagnostics: {
        missingArtifacts: missingArtifacts.length ? missingArtifacts : undefined,
        timelineEventCount: timelineEvents.length,
        warnings: warnings.length ? warnings : undefined,
      },
    },
    warnings,
  }
}
