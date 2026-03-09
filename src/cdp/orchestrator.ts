import { createCDPClientForTab } from './client'
import { captureCSSProvenanceGraph } from './cssCapture'
import { captureDomSnapshot } from './domSnapshotCapture'
import { mapTargetToCDPNode } from './nodeMapping'
import { captureScreenshots } from './pageCapture'
import { captureRuntimeEnvironment } from './runtimeCapture'
import type { CaptureBundleV0, CaptureSeed } from './types'

const createCaptureId = () => `cdp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

export const runCDPCapture = async (seed: CaptureSeed): Promise<CaptureBundleV0> => {
  if (!seed.tabId) throw new Error('CDP capture requires tabId')

  const client = createCDPClientForTab(seed.tabId)
  const warnings: string[] = []

  await client.attach()
  try {
    const runtime = await captureRuntimeEnvironment(client)
    const screenshot = await captureScreenshots(client, seed.boundingBox)
    const domSnapshot = await captureDomSnapshot(client)
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

    return {
      version: '0',
      captureId: createCaptureId(),
      createdAt: new Date().toISOString(),
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
      nodeMapping,
      cssGraph,
      debug: { warnings },
    }
  } catch (error) {
    warnings.push(String(error))
    throw error
  } finally {
    await client.detach().catch(() => undefined)
  }
}
