import type { Page } from '@playwright/test'
import type { TargetClass, TargetSubtype } from '../cdp/nodeMappingTypes'

export interface BenchmarkScenarioDefinition {
  id: string
  title: string
  description: string
  url: string
  expectedTargetClass?: TargetClass
  expectedTargetSubtype?: TargetSubtype
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

const inlineScenarioUrl = (html: string) => `data:text/html;charset=utf-8,${encodeURIComponent(html)}`

const semanticLeafButtonHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Primary CTA Button</title>
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: linear-gradient(180deg, #f8fafc 0%, #e2e8f0 100%); font-family: Inter, system-ui, sans-serif; }
      button { border: 0; border-radius: 999px; background: #111827; color: #fff; padding: 16px 28px; font-size: 16px; font-weight: 700; box-shadow: 0 12px 30px rgba(15, 23, 42, 0.18); }
    </style>
  </head>
  <body>
    <button id="primary-cta" type="button" aria-label="Start free trial">Start free trial</button>
  </body>
</html>`

const loginFormHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Login Form</title>
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0f172a; font-family: Inter, system-ui, sans-serif; }
      form { width: 360px; background: rgba(255,255,255,0.96); border-radius: 20px; padding: 24px; box-shadow: 0 24px 60px rgba(15,23,42,0.35); display: grid; gap: 14px; }
      label { display: grid; gap: 6px; color: #0f172a; font-size: 14px; font-weight: 600; }
      input { border: 1px solid #cbd5e1; border-radius: 12px; padding: 12px 14px; font: inherit; }
      button { border: 0; border-radius: 12px; padding: 12px 16px; background: #2563eb; color: white; font: inherit; font-weight: 700; }
    </style>
  </head>
  <body>
    <form id="login-form">
      <label>Email<input type="email" name="email" placeholder="samuel@example.com" /></label>
      <label>Password<input type="password" name="password" placeholder="••••••••" /></label>
      <button type="submit">Sign in</button>
    </form>
  </body>
</html>`

const marketingHeroHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Marketing Hero</title>
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: radial-gradient(circle at top, #1d4ed8 0%, #0f172a 55%, #020617 100%); color: white; font-family: Inter, system-ui, sans-serif; }
      section { width: min(1120px, calc(100vw - 64px)); padding: 56px; border-radius: 32px; background: linear-gradient(135deg, rgba(255,255,255,0.16), rgba(255,255,255,0.06)); backdrop-filter: blur(20px); box-shadow: 0 40px 100px rgba(15, 23, 42, 0.45); display: grid; grid-template-columns: 1.3fr 1fr; gap: 32px; align-items: center; }
      h1 { margin: 0 0 16px; font-size: 64px; line-height: 0.95; }
      p { margin: 0 0 24px; font-size: 18px; line-height: 1.6; color: rgba(255,255,255,0.84); }
      .hero-card { border-radius: 24px; background: rgba(15,23,42,0.5); padding: 24px; border: 1px solid rgba(255,255,255,0.12); }
    </style>
  </head>
  <body>
    <section id="marketing-hero">
      <div>
        <div style="display:inline-flex;padding:8px 12px;border-radius:999px;background:rgba(255,255,255,0.12);margin-bottom:18px;">Spring launch</div>
        <h1>Ship polished UI snapshots without manual cleanup.</h1>
        <p>Capture, classify and benchmark component exports with enough structure to catch policy drift before it hits the product.</p>
      </div>
      <div class="hero-card">
        <div style="font-size:14px;opacity:.72;margin-bottom:12px;">Last benchmark run</div>
        <div style="font-size:40px;font-weight:800;">98.4%</div>
        <div style="margin-top:12px;height:10px;border-radius:999px;background:rgba(255,255,255,0.12);overflow:hidden;"><div style="width:76%;height:100%;background:linear-gradient(90deg,#34d399,#60a5fa);"></div></div>
      </div>
    </section>
  </body>
</html>`

const editorToolbarHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Editor Toolbar</title>
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f1f5f9; font-family: Inter, system-ui, sans-serif; }
      .toolbar { display: flex; gap: 10px; align-items: center; padding: 14px; border-radius: 18px; background: white; box-shadow: 0 18px 40px rgba(15, 23, 42, 0.12); border: 1px solid #e2e8f0; }
      .tool { width: 42px; height: 42px; border-radius: 12px; border: 1px solid #cbd5e1; display: grid; place-items: center; background: linear-gradient(180deg, #fff, #f8fafc); font-weight: 700; color: #0f172a; }
      .divider { width: 1px; height: 30px; background: #e2e8f0; margin: 0 4px; }
    </style>
  </head>
  <body>
    <div id="editor-toolbar" class="toolbar" role="toolbar" aria-label="Formatting toolbar">
      <button class="tool" type="button" aria-label="Bold">B</button>
      <button class="tool" type="button" aria-label="Italic">I</button>
      <button class="tool" type="button" aria-label="Underline">U</button>
      <div class="divider" aria-hidden="true"></div>
      <button class="tool" type="button" aria-label="Align left">≡</button>
      <button class="tool" type="button" aria-label="List">•</button>
    </div>
  </body>
</html>`

const analyticsChartHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Analytics Chart Card</title>
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #020617; font-family: Inter, system-ui, sans-serif; }
      .card { width: 760px; border-radius: 28px; background: linear-gradient(180deg, #0f172a 0%, #111827 100%); color: white; padding: 28px; box-shadow: 0 32px 90px rgba(2, 6, 23, 0.55); }
      .meta { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 18px; }
      .chart-scene { display: block; width: 100%; height: auto; }
    </style>
  </head>
  <body>
    <section class="card">
      <div class="meta">
        <div>
          <div style="font-size:14px;opacity:.7;">Weekly active captures</div>
          <div style="font-size:34px;font-weight:800;">12.4k</div>
        </div>
        <div style="font-size:14px;color:#34d399;">+18.2%</div>
      </div>
      <svg id="analytics-chart" class="chart-scene" viewBox="0 0 700 320" role="img" aria-label="Trend chart">
        <defs>
          <linearGradient id="area-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stop-color="#60a5fa" stop-opacity="0.45" />
            <stop offset="100%" stop-color="#60a5fa" stop-opacity="0.02" />
          </linearGradient>
        </defs>
        <rect x="0" y="0" width="700" height="320" rx="24" fill="#0b1220" />
        <g stroke="#1e293b" stroke-width="1">
          <line x1="48" y1="64" x2="652" y2="64" />
          <line x1="48" y1="128" x2="652" y2="128" />
          <line x1="48" y1="192" x2="652" y2="192" />
          <line x1="48" y1="256" x2="652" y2="256" />
        </g>
        <path d="M48 256 C108 220, 140 190, 184 176 S268 110, 320 132 S410 220, 462 170 S560 88, 652 104 L652 288 L48 288 Z" fill="url(#area-fill)" />
        <path d="M48 256 C108 220, 140 190, 184 176 S268 110, 320 132 S410 220, 462 170 S560 88, 652 104" fill="none" stroke="#60a5fa" stroke-width="6" stroke-linecap="round" />
      </svg>
    </section>
  </body>
</html>`

const pricingCardHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Pricing Card</title>
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #e2e8f0; font-family: Inter, system-ui, sans-serif; }
      .card { width: 360px; border-radius: 28px; padding: 28px; background: white; box-shadow: 0 24px 80px rgba(15, 23, 42, 0.16); display: grid; gap: 16px; }
      .pill { display: inline-flex; padding: 6px 10px; border-radius: 999px; background: #dbeafe; color: #1d4ed8; font-size: 12px; font-weight: 700; }
      .price { font-size: 48px; font-weight: 800; line-height: 1; }
      ul { margin: 0; padding-left: 18px; color: #475569; display: grid; gap: 8px; }
      button { border: 0; border-radius: 14px; background: #111827; color: white; padding: 14px 18px; font: inherit; font-weight: 700; }
    </style>
  </head>
  <body>
    <article id="pricing-card" class="card">
      <div class="pill">Pro</div>
      <div>
        <div style="font-size:16px;color:#475569;">Team plan</div>
        <div class="price">€24</div>
      </div>
      <ul>
        <li>Unlimited snapshots</li>
        <li>Benchmark history</li>
        <li>Shared review links</li>
      </ul>
      <button type="button">Start plan</button>
    </article>
  </body>
</html>`

const miniBoardHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Mini Strategy Board</title>
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0f172a; font-family: Inter, system-ui, sans-serif; }
      .board-shell { padding: 24px; border-radius: 28px; background: rgba(255,255,255,0.06); box-shadow: 0 30px 80px rgba(2,6,23,.5); }
      .board { display: grid; grid-template-columns: repeat(8, 56px); grid-template-rows: repeat(8, 56px); border-radius: 18px; overflow: hidden; }
      .sq-dark { background: #7c3aed; }
      .sq-light { background: #ede9fe; }
      .piece { display: grid; place-items: center; font-size: 26px; }
    </style>
  </head>
  <body>
    <div class="board-shell">
      <div id="mini-board" class="board" role="img" aria-label="Board position">
        <div class="sq-light piece">♜</div><div class="sq-dark"></div><div class="sq-light"></div><div class="sq-dark"></div><div class="sq-light piece">♚</div><div class="sq-dark"></div><div class="sq-light"></div><div class="sq-dark piece">♜</div>
        <div class="sq-dark"></div><div class="sq-light piece">♟</div><div class="sq-dark piece">♟</div><div class="sq-light"></div><div class="sq-dark"></div><div class="sq-light piece">♟</div><div class="sq-dark piece">♟</div><div class="sq-light"></div>
        <div class="sq-light"></div><div class="sq-dark"></div><div class="sq-light"></div><div class="sq-dark"></div><div class="sq-light piece">♞</div><div class="sq-dark"></div><div class="sq-light"></div><div class="sq-dark"></div>
        <div class="sq-dark"></div><div class="sq-light"></div><div class="sq-dark piece">♝</div><div class="sq-light"></div><div class="sq-dark"></div><div class="sq-light"></div><div class="sq-dark"></div><div class="sq-light"></div>
        <div class="sq-light"></div><div class="sq-dark"></div><div class="sq-light"></div><div class="sq-dark piece">♘</div><div class="sq-light"></div><div class="sq-dark"></div><div class="sq-light"></div><div class="sq-dark"></div>
        <div class="sq-dark"></div><div class="sq-light"></div><div class="sq-dark"></div><div class="sq-light"></div><div class="sq-dark"></div><div class="sq-light piece">♗</div><div class="sq-dark"></div><div class="sq-light"></div>
        <div class="sq-light piece">♙</div><div class="sq-dark piece">♙</div><div class="sq-light"></div><div class="sq-dark"></div><div class="sq-light piece">♙</div><div class="sq-dark piece">♙</div><div class="sq-light"></div><div class="sq-dark"></div>
        <div class="sq-dark piece">♖</div><div class="sq-light"></div><div class="sq-dark"></div><div class="sq-light piece">♕</div><div class="sq-dark piece">♔</div><div class="sq-light"></div><div class="sq-dark"></div><div class="sq-light piece">♖</div>
      </div>
    </div>
  </body>
</html>`

const cityMapHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>City Map</title>
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #cbd5e1; font-family: Inter, system-ui, sans-serif; }
      .frame { width: 780px; padding: 20px; border-radius: 28px; background: rgba(255,255,255,.55); box-shadow: 0 30px 90px rgba(15,23,42,.18); }
      svg { width: 100%; height: auto; display:block; border-radius: 20px; }
    </style>
  </head>
  <body>
    <div class="frame">
      <svg id="city-map" viewBox="0 0 760 460" role="img" aria-label="City map with route and pins">
        <rect width="760" height="460" rx="28" fill="#dff2e2" />
        <path d="M0 120 C120 90, 180 160, 320 140 S540 90, 760 130" fill="none" stroke="#93c5fd" stroke-width="48" opacity=".7" />
        <path d="M48 380 L172 292 L260 318 L352 226 L446 248 L560 138 L690 178" fill="none" stroke="#64748b" stroke-width="18" stroke-linecap="round" stroke-linejoin="round" />
        <path d="M70 82 h140 v62 h-140z M274 66 h110 v76 h-110z M520 292 h160 v88 h-160z" fill="#bbf7d0" opacity=".9" />
        <circle cx="172" cy="292" r="14" fill="#ef4444" />
        <circle cx="352" cy="226" r="14" fill="#ef4444" />
        <circle cx="560" cy="138" r="14" fill="#ef4444" />
        <path d="M172 292 C228 236, 300 250, 352 226 S494 180, 560 138" fill="none" stroke="#0f172a" stroke-width="8" stroke-dasharray="18 14" />
      </svg>
    </div>
  </body>
</html>`

const canvasChartHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Canvas Revenue Chart</title>
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #020617; font-family: Inter, system-ui, sans-serif; }
      .card { width: 760px; border-radius: 28px; background: linear-gradient(180deg, #0f172a 0%, #111827 100%); color: white; padding: 28px; box-shadow: 0 32px 90px rgba(2, 6, 23, 0.55); }
      canvas { display:block; width: 100%; height: auto; border-radius: 18px; background: #0b1220; }
    </style>
  </head>
  <body>
    <section class="card">
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:18px;">
        <div><div style="font-size:14px;opacity:.7;">Monthly revenue</div><div style="font-size:34px;font-weight:800;">€84k</div></div>
        <div style="font-size:14px;color:#34d399;">+12.6%</div>
      </div>
      <canvas id="canvas-revenue-chart" width="700" height="320" aria-label="Revenue chart"></canvas>
      <script>
        const c = document.getElementById('canvas-revenue-chart');
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#0b1220'; ctx.fillRect(0,0,c.width,c.height);
        ctx.strokeStyle = '#1e293b'; ctx.lineWidth = 1;
        [60,120,180,240].forEach(y=>{ ctx.beginPath(); ctx.moveTo(40,y); ctx.lineTo(660,y); ctx.stroke(); });
        const pts = [[40,250],[120,228],[200,210],[280,160],[360,178],[440,142],[520,116],[660,96]];
        ctx.beginPath(); ctx.moveTo(40,280); pts.forEach(([x,y])=>ctx.lineTo(x,y)); ctx.lineTo(660,280); ctx.closePath();
        const g = ctx.createLinearGradient(0,80,0,280); g.addColorStop(0,'rgba(96,165,250,.45)'); g.addColorStop(1,'rgba(96,165,250,.03)');
        ctx.fillStyle = g; ctx.fill();
        ctx.beginPath(); pts.forEach(([x,y],i)=> i?ctx.lineTo(x,y):ctx.moveTo(x,y));
        ctx.strokeStyle = '#60a5fa'; ctx.lineWidth = 6; ctx.lineJoin='round'; ctx.lineCap='round'; ctx.stroke();
      </script>
    </section>
  </body>
</html>`

const dashboardHeroHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Dashboard Hero</title>
    <style>
      body { margin: 0; min-height: 100vh; display:grid; place-items:center; background: linear-gradient(180deg,#111827,#020617); color:white; font-family: Inter, system-ui, sans-serif; }
      section { width:min(1180px, calc(100vw - 64px)); padding: 44px; border-radius: 32px; background: rgba(255,255,255,.06); box-shadow: 0 40px 100px rgba(2,6,23,.55); display:grid; grid-template-columns: 1.1fr .9fr; gap:28px; }
      .stats { display:grid; grid-template-columns: repeat(2,1fr); gap:16px; }
      .card { border-radius: 22px; background: rgba(15,23,42,.58); padding: 18px; border:1px solid rgba(255,255,255,.1); }
      h1 { margin:0 0 12px; font-size:56px; line-height:.95; }
      p { margin:0; color:rgba(255,255,255,.8); line-height:1.6; }
    </style>
  </head>
  <body>
    <section id="dashboard-hero">
      <div>
        <div style="display:inline-flex;padding:8px 12px;border-radius:999px;background:rgba(96,165,250,.18);margin-bottom:18px;">Control center</div>
        <h1>Track launches, alerts and quality in one surface.</h1>
        <p>Review benchmark health, pipeline drift, active incidents and team actions without bouncing across tabs.</p>
      </div>
      <div class="stats">
        <div class="card"><div style="opacity:.7;font-size:13px;">Incidents</div><div style="font-size:36px;font-weight:800;">3</div></div>
        <div class="card"><div style="opacity:.7;font-size:13px;">Benchmarks</div><div style="font-size:36px;font-weight:800;">148</div></div>
        <div class="card"><div style="opacity:.7;font-size:13px;">Coverage</div><div style="font-size:36px;font-weight:800;">92%</div></div>
        <div class="card"><div style="opacity:.7;font-size:13px;">Latency</div><div style="font-size:36px;font-weight:800;">184ms</div></div>
      </div>
    </section>
  </body>
</html>`

export const benchmarkScenarios: BenchmarkScenarioDefinition[] = [
  {
    id: 'google-search-bar',
    title: 'Google search bar',
    description: 'Captures the canonical Google search input on the homepage.',
    url: 'https://www.google.com',
    expectedTargetClass: 'semantic-shell',
    expectedTargetSubtype: 'search-like',
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
    expectedTargetClass: 'interactive-composite',
    expectedTargetSubtype: 'generic',
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
    expectedTargetClass: 'render-scene',
    expectedTargetSubtype: 'board-like',
    selectors: ['cg-board'],
    viewport: { width: 1440, height: 1100 },
    waitUntil: 'domcontentloaded',
    notes: ['The harness targets the static analysis board; full engine/animation parity remains out of scope.'],
    prepare: lichessPrepare,
  },
  {
    id: 'primary-cta-button',
    title: 'Primary CTA button',
    description: 'Captures a compact leaf button without any wrapper semantics.',
    url: inlineScenarioUrl(semanticLeafButtonHtml),
    expectedTargetClass: 'semantic-leaf',
    expectedTargetSubtype: 'generic',
    selectors: ['#primary-cta'],
    viewport: { width: 1280, height: 900 },
    waitUntil: 'load',
    notes: ['Deterministic inline fixture for the compact semantic-leaf family.'],
  },
  {
    id: 'login-form-card',
    title: 'Login form card',
    description: 'Captures a form-root interactive composite fixture.',
    url: inlineScenarioUrl(loginFormHtml),
    expectedTargetClass: 'interactive-composite',
    expectedTargetSubtype: 'form-like',
    selectors: ['#login-form'],
    viewport: { width: 1280, height: 960 },
    waitUntil: 'load',
    notes: ['Deterministic inline fixture for the form-like preservation path.'],
  },
  {
    id: 'marketing-hero-section',
    title: 'Marketing hero section',
    description: 'Captures a dense landing-page hero block with multiple visual subregions.',
    url: inlineScenarioUrl(marketingHeroHtml),
    expectedTargetClass: 'noisy-container',
    expectedTargetSubtype: 'generic',
    selectors: ['#marketing-hero'],
    viewport: { width: 1440, height: 1080 },
    waitUntil: 'load',
    notes: ['Deterministic inline fixture for a noisy-container target that should expose current classifier gaps.'],
  },
  {
    id: 'editor-toolbar-cluster',
    title: 'Editor toolbar cluster',
    description: 'Captures a shell-like toolbar grouping instead of a single control.',
    url: inlineScenarioUrl(editorToolbarHtml),
    expectedTargetClass: 'semantic-shell',
    expectedTargetSubtype: 'toolbar-like',
    selectors: ['#editor-toolbar'],
    viewport: { width: 1280, height: 900 },
    waitUntil: 'load',
    notes: ['Deterministic inline fixture for toolbar-like shell classification coverage.'],
  },
  {
    id: 'analytics-chart-card',
    title: 'Analytics chart card',
    description: 'Captures an SVG-based analytics widget rendered as a chart scene.',
    url: inlineScenarioUrl(analyticsChartHtml),
    expectedTargetClass: 'render-scene',
    expectedTargetSubtype: 'chart-like',
    selectors: ['#analytics-chart'],
    viewport: { width: 1440, height: 1080 },
    waitUntil: 'load',
    notes: ['Deterministic inline fixture for chart-like render-scene coverage. Current heuristics still collapse chart-vs-board.'],
  },
  {
    id: 'pricing-card',
    title: 'Pricing card',
    description: 'Captures a compact product card with headline, pricing and CTA.',
    url: inlineScenarioUrl(pricingCardHtml),
    expectedTargetClass: 'semantic-shell',
    expectedTargetSubtype: 'card-like',
    selectors: ['#pricing-card'],
    viewport: { width: 1280, height: 960 },
    waitUntil: 'load',
    notes: ['Deterministic inline fixture for card-like shell coverage.'],
  },
  {
    id: 'mini-board',
    title: 'Mini strategy board',
    description: 'Captures a deterministic board-like grid scene without external dependencies.',
    url: inlineScenarioUrl(miniBoardHtml),
    expectedTargetClass: 'render-scene',
    expectedTargetSubtype: 'board-like',
    selectors: ['#mini-board'],
    viewport: { width: 1280, height: 960 },
    waitUntil: 'load',
    notes: ['Deterministic inline fixture for a second board-like render-scene target.'],
  },
  {
    id: 'city-map',
    title: 'City map',
    description: 'Captures an SVG route map with pins and land blocks.',
    url: inlineScenarioUrl(cityMapHtml),
    expectedTargetClass: 'render-scene',
    expectedTargetSubtype: 'map-like',
    selectors: ['#city-map'],
    viewport: { width: 1440, height: 1024 },
    waitUntil: 'load',
    notes: ['Deterministic inline fixture for map-like render-scene coverage.'],
  },
  {
    id: 'canvas-revenue-chart',
    title: 'Canvas revenue chart',
    description: 'Captures a canvas-based chart so chart detection does not depend on SVG only.',
    url: inlineScenarioUrl(canvasChartHtml),
    expectedTargetClass: 'render-scene',
    expectedTargetSubtype: 'chart-like',
    selectors: ['#canvas-revenue-chart'],
    viewport: { width: 1440, height: 1080 },
    waitUntil: 'load',
    notes: ['Deterministic inline fixture for non-SVG chart-like render-scene coverage.'],
  },
  {
    id: 'dashboard-hero',
    title: 'Dashboard hero',
    description: 'Captures a second dense multi-region landing/dashboard container.',
    url: inlineScenarioUrl(dashboardHeroHtml),
    expectedTargetClass: 'noisy-container',
    expectedTargetSubtype: 'generic',
    selectors: ['#dashboard-hero'],
    viewport: { width: 1440, height: 1080 },
    waitUntil: 'load',
    notes: ['Deterministic inline fixture for a second noisy-container target to reduce overfitting.'],
  },
]

export const benchmarkScenarioGroups: Record<string, string[]> = {
  'class:semantic-leaf': ['primary-cta-button'],
  'class:semantic-shell': ['google-search-bar', 'editor-toolbar-cluster', 'pricing-card'],
  'class:interactive-composite': ['reddit-header', 'login-form-card'],
  'class:render-scene': ['lichess-board', 'analytics-chart-card', 'mini-board', 'city-map', 'canvas-revenue-chart'],
  'class:noisy-container': ['marketing-hero-section', 'dashboard-hero'],
  'matrix:core': ['google-search-bar', 'reddit-header', 'lichess-board'],
  'matrix:extended': [
    'google-search-bar',
    'reddit-header',
    'lichess-board',
    'primary-cta-button',
    'login-form-card',
    'marketing-hero-section',
    'editor-toolbar-cluster',
    'analytics-chart-card',
    'pricing-card',
    'mini-board',
    'city-map',
    'canvas-revenue-chart',
    'dashboard-hero',
  ],
  'matrix:deterministic': [
    'primary-cta-button',
    'login-form-card',
    'marketing-hero-section',
    'editor-toolbar-cluster',
    'analytics-chart-card',
    'pricing-card',
    'mini-board',
    'city-map',
    'canvas-revenue-chart',
    'dashboard-hero',
  ],
}

export const getBenchmarkScenario = (scenarioId: string) =>
  benchmarkScenarios.find((scenario) => scenario.id === scenarioId)
