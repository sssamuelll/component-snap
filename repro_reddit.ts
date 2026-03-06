import { chromium } from '@playwright/test'
import path from 'node:path'

const EXTENSION_PATH = path.resolve('dist')

async function run() {
  console.log('Starting Deep Reddit Analysis...')
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
    await page.waitForTimeout(5000)
    
    console.log('Analyzing original header structure...')
    const headerData = await page.evaluate(() => {
      const header = document.querySelector('header');
      if (!header) return 'No header found';
      
      const icons = header.querySelectorAll('shreddit-icon');
      const shadowRoots = Array.from(header.querySelectorAll('*')).filter(el => el.shadowRoot);
      
      return {
        tag: header.tagName,
        iconsCount: icons.length,
        shadowRootsCount: shadowRoots.length,
        firstShadowContent: shadowRoots[0]?.shadowRoot?.innerHTML.slice(0, 100)
      };
    });
    console.log('Original Header Info:', headerData);

    console.log('Triggering capture...')
    let [serviceWorker] = context.serviceWorkers()
    if (!serviceWorker) serviceWorker = await context.waitForEvent('serviceworker')

    await serviceWorker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (tab.id) await chrome.tabs.sendMessage(tab.id, { type: 'START_INSPECT', requestId: 'reddit-deep-repro' })
    })

    // Click top left
    await page.mouse.click(100, 20)

    console.log('Waiting for snap...')
    let snap: any = null
    for (let i = 0; i < 40; i++) {
      snap = await serviceWorker.evaluate(async () => {
        const data = (await chrome.storage.local.get(['lastSelection'])) as any
        return data.lastSelection ?? null
      })
      if (snap && snap.requestId === 'reddit-deep-repro') break
      await new Promise(r => setTimeout(r, 500))
    }

    if (snap) {
      console.log('Snap captured!');
      console.log('Snap Tag:', snap.element.tag);
      const iconMatches = (snap.element.html.match(/shreddit-icon/g) || []).length;
      console.log('Icons in snap HTML:', iconMatches);
      
      // Check if any shadow content was flattened
      console.log('HTML sample:', snap.element.html.slice(0, 500));
    }

  } catch (err) {
    console.error('Error:', err)
  } finally {
    await new Promise(r => setTimeout(r, 10000))
    await context.close()
  }
}

run()
