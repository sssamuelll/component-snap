import { formatFidelityReport } from '../cdp/fidelityReporting.ts'
import type { FidelityScoringV0, PixelDiffMetricsV0 } from '../cdp/types.ts'

export type BenchmarkScenarioStatus = 'passed' | 'failed' | 'skipped'

export interface BenchmarkArtifactRecord {
  path: string
  pixelDiff?: PixelDiffMetricsV0
  structuralWarnings?: string[]
  structuralEvidence?: string[]
  preservationReasons?: string[]
}

export interface BenchmarkBaselineRecord {
  path: string
  updated: boolean
  drift?: PixelDiffMetricsV0
}

export interface BenchmarkScenarioModeResult {
  reportPath?: string
  score?: number
  confidence?: number
  artifact?: BenchmarkArtifactRecord
}

export interface BenchmarkScenarioResult {
  scenarioId: string
  title: string
  status: BenchmarkScenarioStatus
  url: string
  selector?: string
  originalSelector?: string
  promotedSelector?: string
  promotionReason?: string
  promotionPath?: string[]
  exportTier?: string
  expectedTargetClass?: string
  expectedTargetSubtype?: string
  targetClassHint?: string
  targetSubtypeHint?: string
  targetClassReasons?: string[]
  startedAt: string
  completedAt: string
  warnings: string[]
  notes: string[]
  baseline?: BenchmarkBaselineRecord
  replay?: BenchmarkScenarioModeResult
  portable?: BenchmarkScenarioModeResult
}

export interface BenchmarkSuiteResult {
  suite: string
  version: string
  startedAt: string
  completedAt: string
  outputDir: string
  scenarios: BenchmarkScenarioResult[]
}

const formatRatio = (value: number) => value.toFixed(3)

const summarizePixelDiff = (label: string, metrics?: PixelDiffMetricsV0) => {
  if (!metrics) return `${label}: not available`
  return `${label}: mismatch=${formatRatio(metrics.mismatchRatio)} pixels=${metrics.mismatchPixels} dimensionsMatch=${metrics.dimensionsMatch}`
}

const summarizeStructuralChecks = (label: string, artifact?: BenchmarkArtifactRecord) => {
  if (!artifact?.structuralWarnings?.length && !artifact?.structuralEvidence?.length && !artifact?.preservationReasons?.length) {
    return `${label}: not available`
  }

  const warnings = artifact.structuralWarnings?.length ? artifact.structuralWarnings.join(', ') : 'none'
  const evidence = artifact.structuralEvidence?.length ? artifact.structuralEvidence.join(', ') : 'none'
  const preservation = artifact.preservationReasons?.length ? artifact.preservationReasons.join(', ') : 'none'
  return `${label}: warnings=${warnings} | evidence=${evidence} | preservation=${preservation}`
}

export const buildScenarioReport = (input: {
  result: BenchmarkScenarioResult
  replayScoring?: FidelityScoringV0
  portableScoring?: FidelityScoringV0
  suite: string
  version: string
}) => {
  const { result, replayScoring, portableScoring, suite, version } = input
  const lines = [
    `Component Snap Benchmark Scenario`,
    `Scenario: ${result.title} (${result.scenarioId})`,
    `Status: ${result.status}`,
    `URL: ${result.url}`,
    `Selector: ${result.selector || 'n/a'}`,
    `Original selector: ${result.originalSelector || 'n/a'}`,
    `Promoted selector: ${result.promotedSelector || 'n/a'}`,
    `Promotion reason: ${result.promotionReason || 'n/a'}`,
    `Promotion path: ${result.promotionPath?.join(' -> ') || 'n/a'}`,
    `Export tier: ${result.exportTier || 'n/a'}`,
    `Expected target class: ${result.expectedTargetClass || 'n/a'}`,
    `Expected target subtype: ${result.expectedTargetSubtype || 'n/a'}`,
    `Target class: ${result.targetClassHint || 'n/a'}`,
    `Target subtype: ${result.targetSubtypeHint || 'n/a'}`,
    `Target class reasons: ${result.targetClassReasons?.join(', ') || 'n/a'}`,
    `Started: ${result.startedAt}`,
    `Completed: ${result.completedAt}`,
  ]

  if (result.baseline) {
    lines.push(`Baseline: ${result.baseline.path} (updated=${result.baseline.updated})`)
    lines.push(summarizePixelDiff('Baseline drift', result.baseline.drift))
  }

  if (result.warnings.length) lines.push(`Warnings: ${result.warnings.join(', ')}`)
  if (result.notes.length) lines.push(`Notes: ${result.notes.join(', ')}`)

  if (replayScoring) {
    lines.push('')
    lines.push(
      formatFidelityReport(replayScoring, {
        heading: 'Replay Fidelity',
        benchmark: { suite: `${suite}:${result.scenarioId}:replay`, version },
      }).trimEnd(),
    )
    lines.push(summarizePixelDiff('Replay diff', result.replay?.artifact?.pixelDiff))
    lines.push(summarizeStructuralChecks('Replay structure', result.replay?.artifact))
  }

  if (portableScoring) {
    lines.push('')
    lines.push(
      formatFidelityReport(portableScoring, {
        heading: 'Portable Fidelity',
        benchmark: { suite: `${suite}:${result.scenarioId}:portable`, version },
      }).trimEnd(),
    )
    lines.push(summarizePixelDiff('Portable diff', result.portable?.artifact?.pixelDiff))
    lines.push(summarizeStructuralChecks('Portable structure', result.portable?.artifact))
  }

  return `${lines.join('\n')}\n`
}

export const buildSuiteReport = (suite: BenchmarkSuiteResult) => {
  const passed = suite.scenarios.filter((scenario) => scenario.status === 'passed').length
  const failed = suite.scenarios.filter((scenario) => scenario.status === 'failed').length
  const skipped = suite.scenarios.filter((scenario) => scenario.status === 'skipped').length
  const lines = [
    `Component Snap Benchmark Suite`,
    `Suite: ${suite.suite} @ ${suite.version}`,
    `Started: ${suite.startedAt}`,
    `Completed: ${suite.completedAt}`,
    `Output: ${suite.outputDir}`,
    `Results: passed=${passed} failed=${failed} skipped=${skipped}`,
    '',
  ]

  for (const scenario of suite.scenarios) {
    const summary = [
      `${scenario.scenarioId}: ${scenario.status}`,
      `selector=${scenario.selector || 'n/a'}`,
      `original=${scenario.originalSelector || 'n/a'}`,
      `promoted=${scenario.promotedSelector || 'n/a'}`,
      `promotion=${scenario.promotionReason || 'n/a'}`,
      `tier=${scenario.exportTier || 'n/a'}`,
      `expectedClass=${scenario.expectedTargetClass || 'n/a'}`,
      `expectedSubtype=${scenario.expectedTargetSubtype || 'n/a'}`,
      `class=${scenario.targetClassHint || 'n/a'}`,
      `subtype=${scenario.targetSubtypeHint || 'n/a'}`,
    ]
    if (typeof scenario.replay?.score === 'number') {
      summary.push(`replay=${formatRatio(scenario.replay.score)}`)
    }
    if (typeof scenario.portable?.score === 'number') {
      summary.push(`portable=${formatRatio(scenario.portable.score)}`)
    }
    if (scenario.warnings.length) {
      summary.push(`warnings=${scenario.warnings.length}`)
    }
    lines.push(summary.join(' | '))
  }

  return `${lines.join('\n')}\n`
}
