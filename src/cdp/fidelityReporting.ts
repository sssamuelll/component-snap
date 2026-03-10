import type { FidelityScoringV0 } from './types'

export interface FidelityBenchmarkMetadataV0 {
  suite: string
  version: string
}

export interface FidelityMetaSummaryV0 {
  visual: number
  interaction: number
  assetCompleteness: number
  structuralConfidence: number
  overall: number
  overallConfidence: number
  targetClass?: FidelityScoringV0['targetClass']
  exportMode?: FidelityScoringV0['exportMode']
  benchmark?: FidelityBenchmarkMetadataV0
  pixelDiff?: FidelityScoringV0['pixelDiff']
  warnings?: string[]
  notes?: string[]
}

export interface SerializeFidelityForMetaOptions {
  benchmark?: FidelityBenchmarkMetadataV0
}

export interface FormatFidelityReportOptions extends SerializeFidelityForMetaOptions {
  heading?: string
}

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value))

const round3 = (value: number) => Math.round(clamp(value) * 1000) / 1000

const formatScore = (value: number) => round3(value).toFixed(3)

const describeBand = (value: number) => {
  if (value >= 0.9) return 'excellent'
  if (value >= 0.75) return 'strong'
  if (value >= 0.6) return 'usable'
  if (value >= 0.4) return 'fragile'
  return 'poor'
}

const describeConfidence = (value: number) => {
  if (value >= 0.85) return 'high confidence'
  if (value >= 0.65) return 'moderate confidence'
  return 'low confidence'
}

export const serializeFidelityForMeta = (
  scoring: FidelityScoringV0,
  options: SerializeFidelityForMetaOptions = {},
): FidelityMetaSummaryV0 => ({
  visual: scoring.dimensions.visual.score,
  interaction: scoring.dimensions.interaction.score,
  assetCompleteness: scoring.dimensions.assetCompleteness.score,
  structuralConfidence: scoring.dimensions.structuralConfidence.score,
  overall: scoring.overall.score,
  overallConfidence: scoring.overall.confidence,
  targetClass: scoring.targetClass,
  exportMode: scoring.exportMode,
  benchmark: options.benchmark,
  pixelDiff: scoring.pixelDiff,
  warnings: scoring.warnings.length ? [...scoring.warnings] : undefined,
  notes: scoring.notes.length ? [...scoring.notes] : undefined,
})

export const formatFidelityReport = (
  scoring: FidelityScoringV0,
  options: FormatFidelityReportOptions = {},
): string => {
  const meta = serializeFidelityForMeta(scoring, options)
  const lines = [
    options.heading || 'Component Snap Fidelity Report',
    `Overall: ${formatScore(meta.overall)} (${describeBand(meta.overall)})`,
    `Confidence: ${formatScore(meta.overallConfidence)} (${describeConfidence(meta.overallConfidence)})`,
    `Dimensions: visual=${formatScore(meta.visual)}, interaction=${formatScore(meta.interaction)}, assets=${formatScore(meta.assetCompleteness)}, structure=${formatScore(meta.structuralConfidence)}`,
  ]

  if (meta.benchmark) {
    lines.push(`Benchmark: ${meta.benchmark.suite} @ ${meta.benchmark.version}`)
  }

  if (meta.targetClass || meta.exportMode) {
    lines.push(`Target: ${meta.targetClass || 'unknown'} | Export mode: ${meta.exportMode || 'unknown'}`)
  }

  if (meta.pixelDiff) {
    lines.push(
      `Pixel diff: ratio=${formatScore(meta.pixelDiff.mismatchRatio)}, pixels=${meta.pixelDiff.mismatchPixels}, dimensionsMatch=${meta.pixelDiff.dimensionsMatch}`,
    )
  } else {
    lines.push('Pixel diff: not available (heuristic visual score)')
  }

  if (meta.warnings?.length) {
    lines.push(`Warnings: ${meta.warnings.join(', ')}`)
  }

  if (meta.notes?.length) {
    lines.push(`Notes: ${meta.notes.join(', ')}`)
  }

  return `${lines.join('\n')}\n`
}

export const buildFidelityExport = (scoring: FidelityScoringV0, options: FormatFidelityReportOptions = {}) => ({
  meta: serializeFidelityForMeta(scoring, options),
  report: formatFidelityReport(scoring, options),
})
