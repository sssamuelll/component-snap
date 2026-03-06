import { chromium } from '@playwright/test'
import path from 'node:path'

const EXTENSION_PATH = path.resolve('dist')

async function run() {
  console.log('Starting Google Repro...')
  const context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
    ],
  })

  try {
    const page = await context.newPage()
    page.on('console', msg => console.log('BROWSER:', msg.text()))
    await page.goto('https://www.google.com', { waitUntil: 'networkidle' })
    
    // Accept cookies if present
    const cookieButton = await page.locator('button:has-text("Accept all"), button:has-text("I agree")').first()
    if (await cookieButton.isVisible()) {
      await cookieButton.click()
    }

    console.log('Searching for search bar...')
    const searchBar = page.locator('textarea[name="q"], input[name="q"]').first()
    await searchBar.waitFor({ state: 'visible' })
    
    const box = await searchBar.boundingBox()
    if (!box) throw new Error('Search bar box not found')

    console.log('Triggering capture...')
    let [serviceWorker] = context.serviceWorkers()
    if (!serviceWorker) serviceWorker = await context.waitForEvent('serviceworker')

    await serviceWorker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (tab.id) await chrome.tabs.sendMessage(tab.id, { type: 'START_INSPECT', requestId: 'google-repro' })
    })

    // Click the search bar to snap it
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)

    console.log('Waiting for snap...')
    let snap: { requestId: string; snapFolder: string; element: { html: string; css: string } } | null = null
    for (let i = 0; i < 20; i++) {
      snap = await serviceWorker.evaluate(async () => {
        const data = (await chrome.storage.local.get(['lastSelection'])) as {
          lastSelection?: {
            requestId: string
            snapFolder: string
            element: { html: string; css: string }
          }
        }
        return data.lastSelection ?? null
      })
      if (snap && snap.requestId === 'google-repro') break
      await new Promise(r => setTimeout(r, 500))
    }

    if (!snap) {
      console.error('Snap failed or timed out')
    } else {
      console.log('Snap captured successfully!')
      console.log('Folder:', snap.snapFolder)
      // We can't easily check the filesystem here but we can log the payload size
      console.log('HTML size:', snap.element.html.length)
      console.log('CSS size:', snap.element.css.length)
    }

  } catch (err) {
    console.error('Error:', err)
  } finally {
    // Keep open for a bit to see result if needed, or close
    await new Promise(r => setTimeout(r, 5000))
    await context.close()
  }
}

run()
