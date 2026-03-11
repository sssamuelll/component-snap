import type { Page } from '@playwright/test'

export interface BenchmarkScenarioDefinition {
  id: string
  title: string
  description: string
  url: string
  selectors: string[]
  viewport: {
    width: number
    height: number
  }
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' | 'commit'
  notes?: string[]
  prepare?: (page: Page) => Promise<string[]>
}

const clickIfVisible = async (page: Page, selectors: string[]) => {
  for (const selector of selectors) {
    const locator = page.locator(selector).first()
    if (await locator.isVisible().catch(() => false)) {
      await locator.click({ timeout: 2_000 }).catch(() => undefined)
      return selector
    }
  }
  return null
}

const googlePrepare = async (page: Page) => {
  const warnings: string[] = []
  const accepted = await clickIfVisible(page, [
    'button:has-text("Accept all")',
    'button:has-text("I agree")',
    'button:has-text("Alle akzeptieren")',
  ])
  if (accepted) warnings.push(`scenario-google-consent-clicked:${accepted}`)
  await page.waitForTimeout(800)
  const searchTarget = page.locator('textarea[name="q"], input[name="q"]').first()
  if (await searchTarget.isVisible().catch(() => false)) {
    await searchTarget.scrollIntoViewIfNeeded().catch(() => undefined)
    await searchTarget.focus().catch(() => undefined)
    await page.waitForTimeout(250)
  }
  return warnings
}

const redditPrepare = async (page: Page) => {
  const warnings: string[] = []
  await page.waitForTimeout(3_000)
  const dismissed = await clickIfVisible(page, [
    'button:has-text("Accept all")',
    'button:has-text("Accept")',
    'button:has-text("Continue")',
  ])
  if (dismissed) warnings.push(`scenario-reddit-banner-clicked:${dismissed}`)
  return warnings
}

const lichessPrepare = async (page: Page) => {
  const warnings: string[] = []
  await page.waitForTimeout(2_000)
  const dismissed = await clickIfVisible(page, [
    'button:has-text("Accept")',
    'button:has-text("I agree")',
  ])
  if (dismissed) warnings.push(`scenario-lichess-banner-clicked:${dismissed}`)
  const board = page.locator('cg-board').first()
  if (await board.isVisible().catch(() => false)) {
    await board.scrollIntoViewIfNeeded().catch(() => undefined)
    await page.waitForTimeout(250)
  }
  return warnings
}

export const benchmarkScenarios: BenchmarkScenarioDefinition[] = [
  {
    id: 'google-search-bar',
    title: 'Google search bar',
    description: 'Captures the canonical Google search input on the homepage.',
    url: 'https://www.google.com',
    selectors: ['textarea[name="q"]', 'input[name="q"]'],
    viewport: { width: 1440, height: 960 },
    waitUntil: 'networkidle',
    notes: ['Regional consent flows can cause an honest skip if the search box never becomes interactable.'],
    prepare: googlePrepare,
  },
  {
    id: 'reddit-header',
    title: 'Reddit header',
    description: 'Captures the logged-out Reddit header shell.',
    url: 'https://www.reddit.com',
    selectors: ['shreddit-app header', 'reddit-header-large', 'header', '[data-testid="reddit-header"]'],
    viewport: { width: 1440, height: 1100 },
    waitUntil: 'domcontentloaded',
    notes: ['Reddit markup shifts often; the harness records selector fallbacks and skips rather than masking them.'],
    prepare: redditPrepare,
  },
  {
    id: 'lichess-board',
    title: 'Lichess board',
    description: 'Captures the analysis board surface on lichess.org.',
    url: 'https://lichess.org/analysis',
    selectors: ['cg-board'],
    viewport: { width: 1440, height: 1100 },
    waitUntil: 'domcontentloaded',
    notes: ['The harness targets the static analysis board; full engine/animation parity remains out of scope.'],
    prepare: lichessPrepare,
  },
]

export const getBenchmarkScenario = (scenarioId: string) =>
  benchmarkScenarios.find((scenario) => scenario.id === scenarioId)
