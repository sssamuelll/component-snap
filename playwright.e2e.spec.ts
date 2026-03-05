import { test, expect, chromium } from '@playwright/test'
import path from 'node:path'
import http from 'node:http'

const EXTENSION_PATH = path.join(process.cwd(), 'dist')

test('picker captures a search component with screenshot + selector', async () => {
  test.setTimeout(60000)
  const server = http.createServer((_req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8')
    res.end(`
      <style>
        .search-wrap { padding: 30px; }
        .search-input {
          width: 420px;
          border: 1px solid #dfe1e5;
          border-radius: 9999px;
          padding: 12px 16px;
          transition: box-shadow .15s ease;
        }
        .search-input:hover { box-shadow: 0 1px 6px rgba(32,33,36,.28); }
        .search-input:focus { outline: none; border-color: #4285f4; }
      </style>
      <div class="search-wrap">
        <input id="search" class="search-input" placeholder="Search Google or type a URL" />
      </div>
    `)
  })

  await new Promise<void>((resolve) => server.listen(4179, resolve))

  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
    ],
  })

  try {
    let [serviceWorker] = context.serviceWorkers()
    if (!serviceWorker) serviceWorker = await context.waitForEvent('serviceworker')

    const page = await context.newPage()
    await page.goto('http://127.0.0.1:4179', { waitUntil: 'domcontentloaded' })

    await serviceWorker.evaluate(async () => {
      const tabs = await chrome.tabs.query({ url: 'http://127.0.0.1:4179/*' })
      const tabId = tabs[0]?.id
      if (!tabId) throw new Error('Test tab not found')
      await chrome.tabs.sendMessage(tabId, { type: 'START_INSPECT', requestId: 'e2e-run-1' })
    })

    await page.waitForSelector('#__component_snap_blocker__', { state: 'attached' })
    const box = await page.locator('#search').boundingBox()
    if (!box) throw new Error('search box not found')
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)

    await expect
      .poll(
        async () => {
          return await serviceWorker.evaluate(async () => {
            const result = await chrome.storage.local.get(['lastSelection'])
            return result.lastSelection ?? null
          })
        },
        { timeout: 20000 },
      )
      .not.toBeNull()

    const result = await serviceWorker.evaluate(async () => {
      const data = await chrome.storage.local.get(['lastSelection'])
      return data.lastSelection
    })

    expect(result?.element?.selector).toBeTruthy()
    expect(result?.element?.selectedSelector).toBeTruthy()
    expect(result?.element?.kind).toBe('search-input')
  } finally {
    await context.close()
    server.close()
  }
})
