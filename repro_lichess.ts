import { chromium } from '@playwright/test'
import path from 'node:path'

const EXTENSION_PATH = path.resolve('dist')

async function run() {
  console.log('Starting Lichess Repro...')
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
    // Using a more robust wait
    await page.goto('https://lichess.org/analysis', { timeout: 60000, waitUntil: 'domcontentloaded' })
    
    console.log('Waiting for board elements...')
    // Chessground uses cg-container often as the visual parent
    const board = await page.waitForSelector('cg-board', { timeout: 30000 })
    
    // Get info about the hierarchy
    const structure = await board.evaluate((el) => {
      const parent = el.parentElement;
      return {
        tag: el.tagName,
        parentTag: parent?.tagName,
        parentClass: parent?.className,
        piecesInsideCount: el.querySelectorAll('piece').length,
        siblingsCount: parent ? parent.children.length : 0,
        siblings: parent ? Array.from(parent.children).map(c => c.tagName) : []
      };
    });
    console.log('Structure Info:', JSON.stringify(structure, null, 2));

    const box = await board.boundingBox()
    if (!box) throw new Error('Board box not found')

    console.log('Triggering capture...');
    let [serviceWorker] = context.serviceWorkers()
    if (!serviceWorker) serviceWorker = await context.waitForEvent('serviceworker')

    await serviceWorker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (tab.id) await chrome.tabs.sendMessage(tab.id, { type: 'START_INSPECT', requestId: 'lichess-repro' })
    })

    // Click the board
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)

    console.log('Waiting for snap...')
    let snap: { element: { tag: string; html: string; css: string }; requestId: string } | null = null
    for (let i = 0; i < 40; i++) {
      snap = await serviceWorker.evaluate(async () => {
        const data = (await chrome.storage.local.get(['lastSelection'])) as {
          lastSelection?: {
            element: { tag: string; html: string; css: string }
            requestId: string
          }
        }
        return data.lastSelection ?? null
      })
      if (snap && snap.requestId === 'lichess-repro') break
      await new Promise(r => setTimeout(r, 500))
    }

    if (snap) {
      console.log('Snap captured!');
      console.log('Snap Tag:', snap.element.tag);
      console.log('Snap Children:', (snap.element.html.match(/<[a-z0-9-]+/gi) || []).length);
      console.log('HTML contains piece:', snap.element.html.includes('<piece'));
    }

  } catch (err) {
    console.error('Error:', err)
  } finally {
    await new Promise(r => setTimeout(r, 5000))
    await context.close()
  }
}

run()
