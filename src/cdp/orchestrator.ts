import { createCDPClientForTab } from './client'
import { captureCSSProvenanceGraph } from './cssCapture'
import { captureDomSnapshot } from './domSnapshotCapture'
import { mapTargetToCDPNode } from './nodeMapping'
import { captureScreenshots } from './pageCapture'
import { buildActionTraceTimelineEvents } from './actionTraceTimeline'
import { buildMutationTraceTimelineEvents } from './mutationTraceTimeline'
import { buildReplayCapsule } from './replayCapsule'
import { mergeReplayTimelineEvents } from './replayTimeline'
import { buildResourceGraph } from './resourceGraph'
import { captureRuntimeEnvironment } from './runtimeCapture'
import { captureShadowTopology } from './shadowTopology'
import { scoreCaptureFidelity } from './fidelityScoring'
import type { CaptureBundleV0, CaptureSeed } from './types'

const createCaptureId = () => `cdp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

export const runCDPCapture = async (seed: CaptureSeed): Promise<CaptureBundleV0> => {
  if (!seed.tabId) throw new Error('CDP capture requires tabId')

  const client = createCDPClientForTab(seed.tabId)
  const warnings: string[] = []

  await client.attach()
  try {
    const createdAt = new Date().toISOString()
    const runtime = await captureRuntimeEnvironment(client)
    const screenshot = await captureScreenshots(client, seed.boundingBox)
    const domSnapshot = await captureDomSnapshot(client)
    const shadowTopologyCapture = await captureShadowTopology(client)
    const shadowTopology = shadowTopologyCapture.shadowTopology
    warnings.push(...shadowTopologyCapture.warnings.map((warning) => `shadow_topology: ${warning}`))
    const nodeMapping = await mapTargetToCDPNode(client, seed, domSnapshot.raw).catch((error) => {
      warnings.push(`node_mapping_failed: ${String(error)}`)
      return undefined
    })
    let cssGraph: CaptureBundleV0['cssGraph']

    if (nodeMapping?.resolved && nodeMapping.node?.nodeId) {
      const cssCapture = await captureCSSProvenanceGraph(client, {
        nodeId: nodeMapping.node.nodeId,
        backendNodeId: nodeMapping.node.backendNodeId,
        selector: seed.targetFingerprint?.stableSelector || seed.stableSelector || seed.selectedSelector,
      })

      cssGraph = cssCapture.cssGraph
      warnings.push(...cssCapture.warnings.map((warning) => `css_capture: ${warning}`))
    } else {
      warnings.push('css_capture_skipped: node-unresolved')
    }

    const resourceGraphCapture = buildResourceGraph({
      pageUrl: runtime.url || seed.pageUrl,
      cssGraph,
      shadowTopology,
      domSnapshotRaw: domSnapshot.raw,
    })
    const resourceGraph = resourceGraphCapture.resourceGraph
    warnings.push(...resourceGraphCapture.warnings.map((warning) => `resource_graph: ${warning}`))
    const actionTimelineEvents = buildActionTraceTimelineEvents(seed.actionTraceEvents)
    const mutationTimelineEvents = buildMutationTraceTimelineEvents(seed.mutationTraceEvents)
    const replayCapsuleCapture = buildReplayCapsule({
      createdAt,
      page: {
        url: runtime.url,
        title: runtime.title,
        viewport: runtime.viewport,
        scroll: runtime.scroll,
        dpr: runtime.dpr,
        userAgent: runtime.userAgent,
        colorScheme: runtime.colorScheme,
        language: runtime.language,
      },
      screenshot,
      domSnapshot,
      nodeMapping,
      cssGraph,
      shadowTopology,
      resourceGraph,
      timelineEvents: mergeReplayTimelineEvents(actionTimelineEvents, mutationTimelineEvents),
    })
    const replayCapsule = replayCapsuleCapture.replayCapsule
    warnings.push(...replayCapsuleCapture.warnings.map((warning) => `replay_capsule: ${warning}`))

    const bundle: CaptureBundleV0 = {
      version: '0',
      captureId: createCaptureId(),
      createdAt,
      backend: 'cdp',
      seed,
      page: {
        url: runtime.url,
        title: runtime.title,
        viewport: runtime.viewport,
        scroll: runtime.scroll,
        dpr: runtime.dpr,
        userAgent: runtime.userAgent,
        colorScheme: runtime.colorScheme,
        language: runtime.language,
      },
      screenshot,
      domSnapshot,
      runtimeHints: runtime.runtimeHints,
      shadowTopology,
      nodeMapping,
      cssGraph,
      resourceGraph,
      replayCapsule,
      debug: { warnings },
    }

    const fidelity = scoreCaptureFidelity({ capture: bundle })
    bundle.fidelity = fidelity
    if (bundle.replayCapsule) {
      bundle.replayCapsule.diagnostics = {
        ...bundle.replayCapsule.diagnostics,
        fidelity,
      }
    }
    warnings.push(...fidelity.warnings.map((warning) => `fidelity: ${warning}`))

    return bundle
  } catch (error) {
    warnings.push(String(error))
    throw error
  } finally {
    await client.detach().catch(() => undefined)
  }
}
