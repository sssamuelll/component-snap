import { chromium, type BrowserContext, type Page } from '@playwright/test'
import { access, copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'

import { buildReplayViewerState } from '../src/cdp/replayViewerState.ts'
import { scoreCaptureFidelity } from '../src/cdp/fidelityScoring.ts'
import { comparePixelDiff } from '../src/cdp/pixelDiff.ts'
import type { CaptureBundleV0 } from '../src/cdp/types.ts'
import type { TargetFingerprint } from '../src/cdp/nodeMappingTypes.ts'
import {
  buildPortablePreviewDocument,
  buildReplayViewerArtifact,
  dataUrlToBuffer,
  inspectPortableArtifactStructure,
  sanitizeArtifactSegment,
} from '../src/benchmark/artifacts.ts'
import { buildScenarioReport, buildSuiteReport, type BenchmarkScenarioResult, type BenchmarkSuiteResult } from '../src/benchmark/reporting.ts'
import { benchmarkScenarioGroups, benchmarkScenarios, getBenchmarkScenario, type BenchmarkScenarioDefinition } from '../src/benchmark/scenarios.ts'

type PortableFallbackExtractionDiagnostics = {
  warnings?: string[]
  confidence?: number
  confidencePenalty?: number
  targetClass?: 'semantic-ui' | 'render-scene'
  targetClassHint?: string
  targetSubtypeHint?: string
  classReasons?: string[]
}

const extractPreservationReasons = (warnings: string[] | undefined) =>
  (warnings || [])
    .filter((warning) => warning.startsWith('replay-capsule-preservation-reason:'))
    .map((warning) => warning.slice('replay-capsule-preservation-reason:'.length))

type StoredSelection = {
  requestId?: string
  exportTier?: 'capsule' | 'fallback'
  exportDiagnostics?: {
    source?: 'replay-capsule' | 'portable-fallback'
    warnings?: string[]
    confidence?: number
    confidencePenalty?: number
    targetClass?: 'semantic-ui' | 'render-scene'
    targetClassHint?: string
    targetSubtypeHint?: string
    classReasons?: string[]
  }
  cdpCapture?: CaptureBundleV0
  element?: {
    selector?: string
    html?: string
    css?: string
    js?: string
    screenshotDataUrl?: string
    portableFallback?: PortableFallbackExtractionDiagnostics
    targetFingerprint?: TargetFingerprint
  }
}

interface BenchmarkCliOptions {
  scenarioIds: string[]
  outputDir: string
  baselineDir: string
  updateBaseline: boolean
  headless: boolean
  timeoutMs: number
  suite: string
  version: string
}

const defaultOptions: BenchmarkCliOptions = {
  scenarioIds: ['all'],
  outputDir: path.resolve(process.cwd(), 'benchmarks/runs'),
  baselineDir: path.resolve(process.cwd(), 'benchmarks/baselines'),
  updateBaseline: false,
  headless: true,
  timeoutMs: 35_000,
  suite: 'component-snap-benchmark',
  version: 'v1',
}

const parseArgs = (argv: string[]): BenchmarkCliOptions => {
  const options = { ...defaultOptions }

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    const next = argv[index + 1]

    if (arg === '--scenario' && next) {
      options.scenarioIds = next.split(',').map((value) => value.trim()).filter(Boolean)
      index += 1
      continue
    }
    if (arg === '--out-dir' && next) {
      options.outputDir = path.resolve(process.cwd(), next)
      index += 1
      continue
    }
    if (arg === '--baseline-dir' && next) {
      options.baselineDir = path.resolve(process.cwd(), next)
      index += 1
      continue
    }
    if (arg === '--timeout-ms' && next) {
      options.timeoutMs = Number.parseInt(next, 10)
      index += 1
      continue
    }
    if (arg === '--suite' && next) {
      options.suite = next
      index += 1
      continue
    }
    if (arg === '--version' && next) {
      options.version = next
      index += 1
      continue
    }
    if (arg === '--update-baseline') {
      options.updateBaseline = true
      continue
    }
    if (arg === '--headed') {
      options.headless = false
      continue
    }
  }

  return options
}

const ensurePathExists = async (targetPath: string) => {
  await access(targetPath)
  return targetPath
}

const getRunLabel = () => new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_')

const getBenchmarkContentScriptLoader = async () => {
  const manifestPath = path.resolve(process.cwd(), 'dist/manifest.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
    content_scripts?: Array<{ js?: string[] }>
  }
  const loader = manifest.content_scripts?.flatMap((entry) => entry.js || []).find((file) => file.includes('content.ts-loader-'))
  if (!loader) throw new Error('Could not resolve content script loader from dist/manifest.json')
  return loader
}

const resolveScenarios = (scenarioIds: string[]) => {
  if (scenarioIds.includes('all')) return benchmarkScenarios

  const expandedIds = scenarioIds.flatMap((scenarioId) => benchmarkScenarioGroups[scenarioId] || [scenarioId])
  const uniqueIds = Array.from(new Set(expandedIds))

  const scenarios = uniqueIds.map((scenarioId) => {
    const scenario = getBenchmarkScenario(scenarioId)
    if (!scenario) throw new Error(`Unknown benchmark scenario "${scenarioId}".`)
    return scenario
  })

  return scenarios
}

const getServiceWorker = async (context: BrowserContext) => {
  let [serviceWorker] = context.serviceWorkers()
  if (!serviceWorker) {
    serviceWorker = await context.waitForEvent('serviceworker', { timeout: 15_000 })
  }
  return serviceWorker
}

const clearLastSelection = async (context: BrowserContext) => {
  const serviceWorker = await getServiceWorker(context)
  await serviceWorker.evaluate(async () => {
    const chromeApi = (globalThis as unknown as { chrome: any }).chrome
    await chromeApi.storage.local.remove('lastSelection')
  })
}

const requestCapture = async (context: BrowserContext, requestId: string, pageUrl: string, contentScriptLoader: string) => {
  const serviceWorker = await getServiceWorker(context)
  return await serviceWorker.evaluate(async ({ captureRequestId, benchmarkPageUrl, contentScriptLoaderPath }) => {
    const chromeApi = (globalThis as unknown as { chrome: any }).chrome
    const diagnostics: Record<string, unknown> = {
      benchmarkPageUrl,
      contentScriptLoaderPath,
      attempts: [] as Record<string, unknown>[],
    }
    const tabs = await chromeApi.tabs.query({})
    diagnostics.tabCount = tabs.length
    const normalizedUrl = (() => {
      try {
        const url = new URL(benchmarkPageUrl)
        return `${url.origin}${url.pathname}`
      } catch {
        return benchmarkPageUrl
      }
    })()
    const tab =
      tabs.find((candidate: any) => {
        if (!candidate?.id || typeof candidate.url !== 'string') return false
        if (candidate.url.startsWith('chrome-extension://')) return false
        try {
          const url = new URL(candidate.url)
          return `${url.origin}${url.pathname}` === normalizedUrl
        } catch {
          return candidate.url === benchmarkPageUrl
        }
      }) || tabs.find((candidate: any) => candidate?.active && candidate?.id && !String(candidate.url || '').startsWith('chrome-extension://'))
    if (!tab?.id) throw new Error(`Benchmark target tab not found for ${benchmarkPageUrl}`)
    diagnostics.selectedTab = {
      id: tab.id,
      url: tab.url,
      title: tab.title,
      active: tab.active,
      status: tab.status,
    }

    const registerResult = (() => {
      const workerGlobal = globalThis as typeof globalThis & {
        __componentSnapRegisterActiveRequest?: (requestId: string, tabId: number) => { ok?: boolean; error?: string }
      }
      return workerGlobal.__componentSnapRegisterActiveRequest?.(captureRequestId, tab.id) || {
        ok: false,
        error: 'Background register helper missing.',
      }
    })()

    diagnostics.registerResult = registerResult
    if (!registerResult?.ok) {
      return { ok: false, error: registerResult?.error || 'Could not register active request.', diagnostics }
    }

    const ensureContentScript = async () => {
      try {
        const execResult = await chromeApi.scripting.executeScript({
          target: { tabId: tab.id },
          files: [contentScriptLoaderPath],
        })
        return { ok: true as const, execResult }
      } catch (error) {
        return { ok: false as const, error: String(error) }
      }
    }

    const probePage = async () => {
      try {
        const execResult = await chromeApi.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            const browserGlobal = globalThis as typeof globalThis & {
              location?: { href?: string }
              document?: { readyState?: string; body?: unknown }
              __componentSnapReady?: boolean
              __componentSnapInjectedAt?: number
              __componentSnapProbe?: {
                href: string
                readyState: string
                hasBody: boolean
                contentReady: boolean
                injectedAt?: number
              }
            }
            browserGlobal.__componentSnapProbe = {
              href: browserGlobal.location?.href || '',
              readyState: browserGlobal.document?.readyState || 'unknown',
              hasBody: !!browserGlobal.document?.body,
              contentReady: !!browserGlobal.__componentSnapReady,
              injectedAt: browserGlobal.__componentSnapInjectedAt,
            }
            return browserGlobal.__componentSnapProbe
          },
        })
        return { ok: true as const, execResult }
      } catch (error) {
        return { ok: false as const, error: String(error) }
      }
    }

    let lastError = 'Could not establish connection. Receiving end does not exist.'

    for (let attempt = 0; attempt < 12; attempt++) {
      const attemptInfo: Record<string, unknown> = { attempt }
      const injected = await ensureContentScript()
      const probe = await probePage()
      attemptInfo.injected = injected.ok ? { ok: true, resultCount: injected.execResult?.length || 0 } : { ok: false, error: injected.error }
      attemptInfo.probe = probe.ok ? (probe.execResult?.[0]?.result || { ok: true }) : { ok: false, error: probe.error }
      ;(diagnostics.attempts as Record<string, unknown>[]).push(attemptInfo)
      if (!injected.ok) lastError = `inject:${injected.error || 'unknown'}`
      else if (!probe.ok) lastError = `probe:${probe.error || 'unknown'}`

      const probeState = probe.ok ? (probe.execResult?.[0]?.result as { contentReady?: boolean; readyState?: string; href?: string } | undefined) : undefined
      if (!probeState?.contentReady) {
        lastError = `content-not-ready:${probeState?.readyState || 'unknown'}:${probeState?.href || benchmarkPageUrl}`
        attemptInfo.lastError = lastError
        await new Promise((resolve) => setTimeout(resolve, 250))
        continue
      }

      const directStart = await chromeApi.scripting.executeScript({
        target: { tabId: tab.id },
        func: (requestId: string) => {
          const browserGlobal = globalThis as typeof globalThis & {
            __componentSnapStartInspect?: (requestId: string) => { ok?: boolean; requestId?: string }
            __componentSnapReady?: boolean
          }
          return {
            ready: !!browserGlobal.__componentSnapReady,
            start: browserGlobal.__componentSnapStartInspect?.(requestId) || { ok: false },
          }
        },
        args: [captureRequestId],
      }).catch((error: unknown) => ({ error: String(error) }))

      const directResult = Array.isArray(directStart)
        ? (directStart[0]?.result as { ready?: boolean; start?: { ok?: boolean; requestId?: string } } | undefined)
        : undefined
      attemptInfo.directStart = Array.isArray(directStart)
        ? directResult || { ok: false }
        : { ok: false, error: (directStart as { error?: string }).error || 'unknown' }
      if (directResult?.start?.ok) {
        diagnostics.successAttempt = attempt
        return { ok: true, requestId: captureRequestId, diagnostics }
      }

      lastError = Array.isArray(directStart)
        ? `direct-start-failed:ready=${String(directResult?.ready)}`
        : String((directStart as { error?: string }).error || 'direct-start-failed')
      attemptInfo.lastError = lastError

      await new Promise((resolve) => setTimeout(resolve, 250))
    }

    diagnostics.finalError = lastError
    return { ok: false, error: lastError, diagnostics }
  }, { captureRequestId: requestId, benchmarkPageUrl: pageUrl, contentScriptLoaderPath: contentScriptLoader })
}

const pollLastSelection = async (context: BrowserContext, requestId: string, timeoutMs: number) => {
  const serviceWorker = await getServiceWorker(context)
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    const selection = await serviceWorker.evaluate(async () => {
      const chromeApi = (globalThis as unknown as { chrome: any }).chrome
      const data = await chromeApi.storage.local.get(['lastSelection'])
      return (data.lastSelection ?? null) as StoredSelection | null
    })
    if (selection?.requestId === requestId) return selection
    await new Promise((resolve) => setTimeout(resolve, 500))
  }

  return null
}

const getDebugLogs = async (context: BrowserContext) => {
  const serviceWorker = await getServiceWorker(context)
  return await serviceWorker.evaluate(async () => {
    const workerGlobal = globalThis as typeof globalThis & {
      __componentSnapGetDebugLogs?: () => unknown[]
    }
    return workerGlobal.__componentSnapGetDebugLogs?.() || []
  })
}

const findTarget = async (page: Page, scenario: BenchmarkScenarioDefinition, timeoutMs: number) => {
  for (const [index, selector] of scenario.selectors.entries()) {
    const locator = page.locator(selector).first()
    try {
      await locator.waitFor({ state: 'visible', timeout: Math.min(timeoutMs, 12_000) })
      return { locator, selector, warnings: index > 0 ? [`scenario-selector-fallback:${selector}`] : [] }
    } catch {
      continue
    }
  }

  return null
}

const writeBuffer = async (targetPath: string, buffer: Buffer) => {
  await mkdir(path.dirname(targetPath), { recursive: true })
  await writeFile(targetPath, buffer)
}

const screenshotLocatorSafely = async (page: Page, locator: ReturnType<Page['locator']>, targetPath?: string) => {
  await locator.scrollIntoViewIfNeeded().catch(() => undefined)
  await page.waitForTimeout(150)

  try {
    const buffer = await locator.screenshot({ type: 'png' })
    if (targetPath) await writeBuffer(targetPath, buffer)
    return buffer
  } catch {
    const box = await locator.boundingBox().catch(() => null)
    if (!box || box.width <= 0 || box.height <= 0) return null
    const buffer = await page.screenshot({
      type: 'png',
      clip: {
        x: Math.max(0, box.x),
        y: Math.max(0, box.y),
        width: Math.max(1, box.width),
        height: Math.max(1, box.height),
      },
    })
    if (targetPath) await writeBuffer(targetPath, buffer)
    return buffer
  }
}

const writeJson = async (targetPath: string, value: unknown) => {
  await mkdir(path.dirname(targetPath), { recursive: true })
  await writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

const writeText = async (targetPath: string, value: string) => {
  await mkdir(path.dirname(targetPath), { recursive: true })
  await writeFile(targetPath, value, 'utf8')
}

const maybeReadBuffer = async (targetPath: string) => {
  try {
    return await readFile(targetPath)
  } catch {
    return null
  }
}

const decodeInlineScenarioHtml = (url: string) => {
  const prefix = 'data:text/html;charset=utf-8,'
  if (!url.startsWith(prefix)) return null
  return decodeURIComponent(url.slice(prefix.length))
}

const startInlineFixtureServer = async (scenarioId: string, html: string) => {
  const server = http.createServer((req, res) => {
    if ((req.url || '/') === '/favicon.ico') {
      res.statusCode = 204
      res.end()
      return
    }
    res.setHeader('content-type', 'text/html; charset=utf-8')
    res.end(html)
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })

  const address = server.address()
  if (!address || typeof address === 'string') throw new Error(`Could not bind inline fixture server for ${scenarioId}`)

  return {
    url: `http://127.0.0.1:${address.port}/${sanitizeArtifactSegment(scenarioId)}.html`,
    close: async () => {
      server.closeIdleConnections?.()
      server.closeAllConnections?.()
      await Promise.race([
        new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
        new Promise<void>((resolve) => setTimeout(resolve, 1_000)),
      ])
    },
  }
}

const renderPortableArtifact = async (
  context: BrowserContext,
  targetPath: string,
  portable: NonNullable<StoredSelection['element']>,
  sourceDimensions: { width: number; height: number },
) => {
  if (!portable.html || !portable.css || !portable.js) return null

  const page = await context.newPage()
  try {
    await page.setViewportSize({
      width: Math.max(480, sourceDimensions.width + 64),
      height: Math.max(320, sourceDimensions.height + 64),
    })
    await page.setContent(
      buildPortablePreviewDocument({
        title: 'Component Snap Portable Preview',
        html: portable.html,
        css: portable.css,
        js: portable.js,
      }),
      { waitUntil: 'load' },
    )
    await page.waitForTimeout(350)
    const buffer = await screenshotLocatorSafely(page, page.locator('#component-snap-frame'), targetPath)
    return buffer
  } finally {
    await page.close()
  }
}

const readCandidateReplayImage = (selection: StoredSelection) => {
  const replayImageDataUrl =
    selection.cdpCapture?.replayCapsule?.snapshot.screenshot.clipDataUrl ||
    selection.element?.screenshotDataUrl ||
    undefined

  if (!replayImageDataUrl) return null
  return dataUrlToBuffer(replayImageDataUrl)
}

const maybeUpdateBaseline = async (
  baselineDir: string,
  scenarioId: string,
  sourcePath: string,
  sourceBuffer: Buffer,
  updateBaseline: boolean,
) => {
  const scenarioDir = path.join(baselineDir, sanitizeArtifactSegment(scenarioId))
  const baselinePath = path.join(scenarioDir, 'source.png')
  const currentBaseline = await maybeReadBuffer(baselinePath)
  const drift = currentBaseline
    ? comparePixelDiff({ baselineImage: currentBaseline, candidateImage: sourceBuffer })
    : undefined

  if (updateBaseline) {
    await mkdir(scenarioDir, { recursive: true })
    await copyFile(sourcePath, baselinePath)
    await writeJson(path.join(scenarioDir, 'meta.json'), {
      scenarioId,
      updatedAt: new Date().toISOString(),
      source: './source.png',
    })
  }

  return {
    path: baselinePath,
    updated: updateBaseline,
    drift,
  }
}

const runScenario = async (
  context: BrowserContext,
  scenario: BenchmarkScenarioDefinition,
  options: BenchmarkCliOptions,
  scenarioOutputDir: string,
  contentScriptLoader: string,
): Promise<BenchmarkScenarioResult> => {
  const startedAt = new Date().toISOString()
  const warnings = [...(scenario.notes || [])]
  const notes: string[] = []
  let requestId = `benchmark-${scenario.id}-${Date.now()}`
  const page = await context.newPage()
  let fixtureServer: { url: string; close: () => Promise<void> } | null = null

  try {
    await page.setViewportSize(scenario.viewport)
    const inlineScenarioHtml = decodeInlineScenarioHtml(scenario.url)
    if (inlineScenarioHtml) {
      fixtureServer = await startInlineFixtureServer(scenario.id, inlineScenarioHtml)
      await page.goto(fixtureServer.url, { waitUntil: scenario.waitUntil || 'load', timeout: options.timeoutMs })
    } else {
      await page.goto(scenario.url, { waitUntil: scenario.waitUntil || 'domcontentloaded', timeout: options.timeoutMs })
    }
    warnings.push(...((await scenario.prepare?.(page)) || []))
    await page.bringToFront()

    const target = await findTarget(page, scenario, options.timeoutMs)
    if (!target) {
      return {
        scenarioId: scenario.id,
        title: scenario.title,
        status: 'skipped',
        url: scenario.url,
        startedAt,
        completedAt: new Date().toISOString(),
        warnings: [...warnings, 'scenario-target-not-found'],
        notes,
      }
    }

    warnings.push(...target.warnings)
    await clearLastSelection(context)

    const sourcePath = path.join(scenarioOutputDir, 'source.png')
    const sourceBuffer = await screenshotLocatorSafely(page, target.locator, sourcePath)
    if (!sourceBuffer) throw new Error(`Could not capture source screenshot for ${target.selector}.`)

    const captureStart = await requestCapture(context, requestId, page.url(), contentScriptLoader)
    if (!captureStart?.ok || !captureStart.requestId) {
      await writeJson(path.join(scenarioOutputDir, 'capture-start.json'), captureStart)
      throw new Error(`Could not start inspection: ${captureStart?.error || 'unknown error'}`)
    }
    await writeJson(path.join(scenarioOutputDir, 'capture-start.json'), captureStart)
    requestId = captureStart.requestId
    await page.waitForSelector('#__component_snap_blocker__', { state: 'attached', timeout: 8_000 })
    const box = await target.locator.boundingBox()
    if (!box) throw new Error(`Could not resolve bounding box for ${target.selector}.`)
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)

    const selection = await pollLastSelection(context, requestId, options.timeoutMs)
    if (!selection) {
      const debugLogs = await getDebugLogs(context)
      await writeJson(path.join(scenarioOutputDir, 'debug-log.json'), debugLogs)
      return {
        scenarioId: scenario.id,
        title: scenario.title,
        status: 'failed',
        url: scenario.url,
        selector: target.selector,
        startedAt,
        completedAt: new Date().toISOString(),
        warnings: [...warnings, 'scenario-capture-timeout'],
        notes: [...notes, 'See debug-log.json for extension-side events.'],
      }
    }

    await writeJson(path.join(scenarioOutputDir, 'capture.json'), selection)
    const debugLogs = await getDebugLogs(context)
    await writeJson(path.join(scenarioOutputDir, 'debug-log.json'), debugLogs)

    const baseline = await maybeUpdateBaseline(
      options.baselineDir,
      scenario.id,
      sourcePath,
      sourceBuffer,
      options.updateBaseline,
    )
    if (!baseline.drift) notes.push('No stored baseline source image yet.')

    const replayBuffer = readCandidateReplayImage(selection)
    let replayScoring = undefined
    let replayArtifact = undefined

    if (replayBuffer && selection.cdpCapture?.replayCapsule) {
      const replayPath = path.join(scenarioOutputDir, 'replay', 'snapshot.png')
      await writeBuffer(replayPath, replayBuffer)
      const replayDiff = comparePixelDiff({ baselineImage: sourceBuffer, candidateImage: replayBuffer })
      await writeBuffer(path.join(scenarioOutputDir, 'replay', 'diff.png'), replayDiff.diffPngBuffer)
      const viewerState = buildReplayViewerState({
        replayCapsule: selection.cdpCapture.replayCapsule,
        captureSeed: selection.cdpCapture.seed,
        mode: 'spotlight',
      })
      await writeJson(path.join(scenarioOutputDir, 'replay', 'viewer-state.json'), viewerState)
      await writeText(path.join(scenarioOutputDir, 'replay', 'viewer.html'), buildReplayViewerArtifact(viewerState))
      replayScoring = scoreCaptureFidelity({ capture: selection.cdpCapture, pixelDiff: replayDiff })
      replayArtifact = {
        path: replayPath,
        pixelDiff: replayDiff,
      }
    } else {
      warnings.push('benchmark-replay-image-unavailable')
    }

    let portableScoring = undefined
    let portableArtifact = undefined
    let portableStructureWarnings: string[] = []
    let portableStructureEvidence: string[] = []
    const portablePreservationReasons = extractPreservationReasons(selection.exportDiagnostics?.warnings)
    if (selection.element?.html && selection.element?.css && selection.element?.js) {
      const portableDir = path.join(scenarioOutputDir, 'portable')
      await writeText(path.join(portableDir, 'component.html'), selection.element.html)
      await writeText(path.join(portableDir, 'component.css'), selection.element.css)
      await writeText(path.join(portableDir, 'component.js'), selection.element.js)

      const portableStructure = inspectPortableArtifactStructure({
        html: selection.element.html,
        js: selection.element.js,
        expectedRootSelector: selection.exportTier === 'fallback' || /data-csnap-root="true"/i.test(selection.element.html)
          ? '[data-csnap-root="true"]'
          : undefined,
        targetClass: selection.exportDiagnostics?.targetClass,
      })
      portableStructureWarnings = portableStructure.warnings
      portableStructureEvidence = portableStructure.evidence
      await writeJson(path.join(portableDir, 'structure.json'), portableStructure)

      const portableBuffer = await renderPortableArtifact(
        context,
        path.join(portableDir, 'render.png'),
        selection.element,
        { width: Math.round(box.width), height: Math.round(box.height) },
      )

      if (portableBuffer) {
        const portableDiff = comparePixelDiff({ baselineImage: sourceBuffer, candidateImage: portableBuffer })
        await writeBuffer(path.join(portableDir, 'diff.png'), portableDiff.diffPngBuffer)
        portableScoring = scoreCaptureFidelity({
          capture: selection.cdpCapture,
          pixelDiff: portableDiff,
          portableDiagnostics: selection.exportDiagnostics,
        })
        portableArtifact = {
          path: path.join(portableDir, 'render.png'),
          pixelDiff: portableDiff,
          structuralWarnings: portableStructureWarnings,
          structuralEvidence: portableStructureEvidence,
          preservationReasons: portablePreservationReasons,
        }
      } else {
        warnings.push('benchmark-portable-render-skipped')
      }
    } else {
      warnings.push('benchmark-portable-artifacts-unavailable')
    }

    const structuralFailureWarnings = portableStructureWarnings.filter((warning) =>
      ['structure-root-missing', 'structure-bootstrap-root-mismatch', 'structure-scene-frame-missing'].includes(warning),
    )
    if (structuralFailureWarnings.length) {
      warnings.push(...structuralFailureWarnings.map((warning) => `benchmark-structural-failure:${warning}`))
      notes.push('Portable artifact failed structural invariants before fidelity comparison.')
    }

    const result: BenchmarkScenarioResult = {
      scenarioId: scenario.id,
      title: scenario.title,
      status: structuralFailureWarnings.length
        ? 'failed'
        : replayScoring || portableScoring
          ? 'passed'
          : 'skipped',
      url: scenario.url,
      selector: target.selector,
      originalSelector:
        selection.element?.targetFingerprint?.originalStableSelector ||
        selection.element?.targetFingerprint?.originalSelectedSelector ||
        undefined,
      promotedSelector:
        selection.element?.targetFingerprint?.promotedStableSelector ||
        selection.element?.targetFingerprint?.promotedSelectedSelector ||
        selection.element?.targetFingerprint?.stableSelector ||
        selection.element?.targetFingerprint?.selectedSelector ||
        undefined,
      promotionReason: selection.element?.targetFingerprint?.promotionReason,
      promotionPath: selection.element?.targetFingerprint?.promotionPath,
      exportTier: selection.exportTier,
      expectedTargetClass: scenario.expectedTargetClass,
      expectedTargetSubtype: scenario.expectedTargetSubtype,
      targetClassHint: selection.exportDiagnostics?.targetClassHint || selection.cdpCapture?.seed?.targetClassHint,
      targetSubtypeHint: selection.exportDiagnostics?.targetSubtypeHint || selection.cdpCapture?.seed?.targetSubtypeHint,
      targetClassReasons: selection.exportDiagnostics?.classReasons || selection.cdpCapture?.seed?.targetClassReasons,
      startedAt,
      completedAt: new Date().toISOString(),
      warnings: [...warnings, ...(selection.exportDiagnostics?.warnings || [])],
      notes,
      baseline,
      replay: replayScoring
        ? {
            reportPath: path.join(scenarioOutputDir, 'replay', 'fidelity.txt'),
            score: replayScoring.overall.score,
            confidence: replayScoring.overall.confidence,
            artifact: replayArtifact,
          }
        : undefined,
      portable: portableScoring
        ? {
            reportPath: path.join(scenarioOutputDir, 'portable', 'fidelity.txt'),
            score: portableScoring.overall.score,
            confidence: portableScoring.overall.confidence,
            artifact: portableArtifact,
          }
        : undefined,
    }

    const scenarioReport = buildScenarioReport({
      result,
      replayScoring,
      portableScoring,
      suite: options.suite,
      version: options.version,
    })
    await writeText(path.join(scenarioOutputDir, 'scenario-report.txt'), scenarioReport)
    if (replayScoring) {
      await writeText(result.replay!.reportPath!, scenarioReport)
    }
    if (portableScoring) {
      await writeText(result.portable!.reportPath!, scenarioReport)
    }

    return result
  } catch (error) {
    return {
      scenarioId: scenario.id,
      title: scenario.title,
      status: 'failed',
      url: scenario.url,
      startedAt,
      completedAt: new Date().toISOString(),
      warnings: [...warnings, `scenario-error:${String(error)}`],
      notes,
    }
  } finally {
    await page.close().catch(() => undefined)
    await fixtureServer?.close().catch(() => undefined)
  }
}

const launchBenchmarkContext = async (extensionPath: string, headless: boolean) => {
  const userDataDir = path.join(os.tmpdir(), `component-snap-benchmark-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  await mkdir(userDataDir, { recursive: true })
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  })

  return { context, userDataDir }
}

const main = async () => {
  const options = parseArgs(process.argv.slice(2))
  const scenarios = resolveScenarios(options.scenarioIds)
  const extensionPath = await ensurePathExists(path.resolve(process.cwd(), 'dist'))
  const contentScriptLoader = await getBenchmarkContentScriptLoader()
  const runOutputDir = path.join(options.outputDir, getRunLabel())
  await mkdir(runOutputDir, { recursive: true })
  await mkdir(options.baselineDir, { recursive: true })

  const startedAt = new Date().toISOString()
  const results: BenchmarkScenarioResult[] = []

  for (const scenario of scenarios) {
    const scenarioOutputDir = path.join(runOutputDir, sanitizeArtifactSegment(scenario.id))
    await mkdir(scenarioOutputDir, { recursive: true })

    const { context, userDataDir } = await launchBenchmarkContext(extensionPath, options.headless)
    try {
      const result = await runScenario(context, scenario, options, scenarioOutputDir, contentScriptLoader)
      results.push(result)
      await writeJson(path.join(scenarioOutputDir, 'result.json'), result)
    } finally {
      await Promise.race([
        context.close().catch(() => undefined),
        new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
      ])
      await rm(userDataDir, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  const suite: BenchmarkSuiteResult = {
    suite: options.suite,
    version: options.version,
    startedAt,
    completedAt: new Date().toISOString(),
    outputDir: runOutputDir,
    scenarios: results,
  }

  await writeJson(path.join(runOutputDir, 'summary.json'), suite)
  await writeText(path.join(runOutputDir, 'summary.txt'), buildSuiteReport(suite))
  console.log(`Benchmark run complete: ${runOutputDir}`)
}

await main()
