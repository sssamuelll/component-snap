import type { CDPClient } from './client'
import { resolveNodeByRuntimeFingerprint } from './nodeResolverRuntime'
import { resolveNodeByDomTraversal } from './nodeResolverDom'
import type { NodeMappingResult, TargetFingerprint } from './nodeMappingTypes'
import type { CaptureSeed } from './types'

type RuntimeEvaluateRemoteObjectResponse = {
  result?: {
    objectId?: string
    subtype?: string
  }
}

type DOMRequestNodeResponse = {
  nodeId: number
}

type DOMDescribeNodeResponse = {
  node?: {
    backendNodeId?: number
  }
}

type DOMSnapshotLike = {
  strings?: unknown[]
}

const clampConfidence = (value: number) => Math.max(0, Math.min(1, value))
const mergeWarnings = (...groups: Array<string[] | undefined>) => groups.flatMap((group) => group || [])
const snapshotConfidenceBonus = (hintCount: number) => {
  if (hintCount <= 0) return 0
  return Math.min(0.06, 0.015 + hintCount * 0.01)
}

const snapshotEvidence = (fingerprint: TargetFingerprint | undefined, domSnapshotRaw?: unknown): string[] => {
  if (!fingerprint || !domSnapshotRaw || typeof domSnapshotRaw !== 'object') return []
  const snapshot = domSnapshotRaw as DOMSnapshotLike
  if (!Array.isArray(snapshot.strings)) return []

  const strings = snapshot.strings.filter((v): v is string => typeof v === 'string')
  const evidence: string[] = []

  if (fingerprint.id && strings.includes(fingerprint.id)) {
    evidence.push('domsnapshot string table contains target id')
  }

  if (fingerprint.tagName && (strings.includes(fingerprint.tagName) || strings.includes(fingerprint.tagName.toUpperCase()))) {
    evidence.push('domsnapshot string table contains target tag')
  }

  const classHit = fingerprint.classList.find((token) => strings.includes(token))
  if (classHit) evidence.push(`domsnapshot string table contains class token: ${classHit}`)

  return evidence
}

const resolveNodeBySelectorFallback = async (
  client: CDPClient,
  selector: string,
  evidenceSeed: string[] = [],
): Promise<NodeMappingResult> => {
  const nodeResponse = await client.send<RuntimeEvaluateRemoteObjectResponse>('Runtime.evaluate', {
    expression: `document.querySelector(${JSON.stringify(selector)})`,
    returnByValue: false,
    awaitPromise: false,
  })

  const remote = nodeResponse.result
  if (!remote?.objectId || remote.subtype !== 'node') {
    return {
      resolved: false,
      confidence: 0,
      strategy: 'unresolved',
      evidence: evidenceSeed,
      warnings: [`selector fallback did not find node for selector: ${selector}`],
    }
  }

  const requested = await client.send<DOMRequestNodeResponse>('DOM.requestNode', { objectId: remote.objectId })
  const described = await client.send<DOMDescribeNodeResponse>('DOM.describeNode', { nodeId: requested.nodeId })

  return {
    resolved: true,
    confidence: 0.28,
    strategy: 'selector-fallback',
    evidence: [...evidenceSeed, 'selector matched a live DOM node'],
    node: {
      objectId: remote.objectId,
      nodeId: requested.nodeId,
      backendNodeId: described.node?.backendNodeId,
    },
    warnings: ['selector-only mapping has weak confidence'],
  }
}

const chooseFallbackSelector = (seed: CaptureSeed) => {
  const fromFingerprint = seed.targetFingerprint
  return (
    fromFingerprint?.promotedStableSelector ||
    fromFingerprint?.promotedSelectedSelector ||
    fromFingerprint?.stableSelector ||
    fromFingerprint?.selectedSelector ||
    seed.selectedSelector ||
    seed.stableSelector
  )
}

export const mapTargetToCDPNode = async (
  client: CDPClient,
  seed: CaptureSeed,
  domSnapshotRaw?: unknown,
): Promise<NodeMappingResult> => {
  const fingerprint = seed.targetFingerprint
  const snapshotHints = snapshotEvidence(fingerprint, domSnapshotRaw)
  const strategyAttempts: NonNullable<NodeMappingResult['diagnostics']>['strategyAttempts'] = []
  const confidenceBonus = snapshotConfidenceBonus(snapshotHints.length)

  if (fingerprint) {
    let runtimeEvidence: string[] = []
    let runtimeWarnings: string[] = []

    try {
      const runtimeResult = await resolveNodeByRuntimeFingerprint(client, fingerprint)
      strategyAttempts.push({
        strategy: runtimeResult.strategy,
        resolved: runtimeResult.resolved,
        confidence: runtimeResult.confidence,
        candidateCount: runtimeResult.candidateCount,
        warnings: runtimeResult.warnings,
      })
      if (runtimeResult.resolved) {
        return {
          ...runtimeResult,
          confidence: clampConfidence(runtimeResult.confidence + confidenceBonus),
          evidence: [...runtimeResult.evidence, ...snapshotHints],
          diagnostics: {
            snapshotHints,
            strategyAttempts,
          },
        }
      }

      runtimeEvidence = runtimeResult.evidence
      runtimeWarnings = runtimeResult.warnings || []
    } catch (error) {
      runtimeWarnings = [`runtime mapping failed: ${String(error)}`]
    }

    try {
      const traversalResult = await resolveNodeByDomTraversal(client, fingerprint)
      strategyAttempts.push({
        strategy: traversalResult.strategy,
        resolved: traversalResult.resolved,
        confidence: traversalResult.confidence,
        candidateCount: traversalResult.candidateCount,
        warnings: traversalResult.warnings,
      })
      if (traversalResult.resolved) {
        return {
          ...traversalResult,
          confidence: clampConfidence(traversalResult.confidence + confidenceBonus),
          evidence: [...runtimeEvidence, ...traversalResult.evidence, ...snapshotHints],
          warnings: mergeWarnings(runtimeWarnings, traversalResult.warnings),
          diagnostics: {
            snapshotHints,
            strategyAttempts,
          },
        }
      }

      const fallbackSelector = chooseFallbackSelector(seed)
      if (fallbackSelector) {
        const fallback = await resolveNodeBySelectorFallback(client, fallbackSelector, [...runtimeEvidence, ...traversalResult.evidence])
        strategyAttempts.push({
          strategy: fallback.strategy,
          resolved: fallback.resolved,
          confidence: fallback.confidence,
          candidateCount: fallback.candidateCount,
          warnings: fallback.warnings,
        })
        return {
          ...fallback,
          evidence: [...fallback.evidence, ...snapshotHints],
          warnings: mergeWarnings(runtimeWarnings, traversalResult.warnings, fallback.warnings),
          diagnostics: {
            snapshotHints,
            strategyAttempts,
          },
        }
      }

      return {
        resolved: false,
        confidence: 0,
        strategy: 'unresolved',
        evidence: [...runtimeEvidence, ...traversalResult.evidence, ...snapshotHints],
        warnings: mergeWarnings(runtimeWarnings, traversalResult.warnings),
        diagnostics: {
          snapshotHints,
          strategyAttempts,
        },
      }
    } catch (error) {
      const fallbackSelector = chooseFallbackSelector(seed)
      if (fallbackSelector) {
        const fallback = await resolveNodeBySelectorFallback(client, fallbackSelector, runtimeEvidence)
        strategyAttempts.push({
          strategy: fallback.strategy,
          resolved: fallback.resolved,
          confidence: fallback.confidence,
          candidateCount: fallback.candidateCount,
          warnings: fallback.warnings,
        })
        return {
          ...fallback,
          evidence: [...fallback.evidence, ...snapshotHints],
          warnings: mergeWarnings(runtimeWarnings, fallback.warnings, [`dom traversal failed: ${String(error)}`]),
          diagnostics: {
            snapshotHints,
            strategyAttempts,
          },
        }
      }

      return {
        resolved: false,
        confidence: 0,
        strategy: 'unresolved',
        evidence: [...runtimeEvidence, ...snapshotHints],
        warnings: mergeWarnings(runtimeWarnings, [`dom traversal failed: ${String(error)}`]),
        diagnostics: {
          snapshotHints,
          strategyAttempts,
        },
      }
    }
  }

  const fallbackSelector = chooseFallbackSelector(seed)
  if (fallbackSelector) {
    const fallback = await resolveNodeBySelectorFallback(client, fallbackSelector)
    strategyAttempts.push({
      strategy: fallback.strategy,
      resolved: fallback.resolved,
      confidence: fallback.confidence,
      candidateCount: fallback.candidateCount,
      warnings: fallback.warnings,
    })
    return {
      ...fallback,
      evidence: [...fallback.evidence, ...snapshotHints],
      diagnostics: {
        snapshotHints,
        strategyAttempts,
      },
    }
  }

  return {
    resolved: false,
    confidence: 0,
    strategy: 'unresolved',
    evidence: snapshotHints,
    warnings: ['no target fingerprint or selector available for CDP node mapping'],
    diagnostics: {
      snapshotHints,
      strategyAttempts,
    },
  }
}
