import { chromium } from '@playwright/test'
import path from 'node:path'

const EXTENSION_PATH = path.resolve('dist')

async function run() {
  console.log('Starting Reddit Repro...')
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
    
    await page.goto('https://www.reddit.com', { waitUntil: 'domcontentloaded', timeout: 60000 })
    
    console.log('Waiting for some content...')
    await page.waitForTimeout(5000); // Wait for dynamic content
    
    // Attempt to find the header area
    const x = 500;
    const y = 20; // Near the top center

    console.log('Triggering capture...')
    let [serviceWorker] = context.serviceWorkers()
    if (!serviceWorker) serviceWorker = await context.waitForEvent('serviceworker')

    await serviceWorker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (tab.id) await chrome.tabs.sendMessage(tab.id, { type: 'START_INSPECT', requestId: 'reddit-repro' })
    })

    // Click near the top to snap the header
    await page.mouse.click(x, y)

    console.log('Waiting for snap...')
    let snap: any = null
    for (let i = 0; i < 40; i++) {
      snap = await serviceWorker.evaluate(async () => {
        const data = await chrome.storage.local.get(['lastSelection'])
        return data.lastSelection ?? null
      })
      if (snap && snap.requestId === 'reddit-repro') break
      await new Promise(r => setTimeout(r, 500))
    }

    if (snap) {
      console.log('Snap captured!');
      console.log('Snap Tag:', snap.element.tag);
      console.log('HTML size:', snap.element.html.length);
      console.log('CSS size:', snap.element.css.length);
    } else {
      console.log('Snap NOT captured.');
    }

  } catch (err) {
    console.error('Error:', err)
  } finally {
    await new Promise(r => setTimeout(r, 10000))
    await context.close()
  }
}

run()
