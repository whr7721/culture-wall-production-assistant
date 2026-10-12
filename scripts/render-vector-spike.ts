import { chromium } from 'playwright-core'
import { readFile } from 'node:fs/promises'

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 1100 }, deviceScaleFactor: 1 })
  const svg = await readFile('output/vector-spike/panel-importable.svg')
  const source = `data:image/svg+xml;base64,${svg.toString('base64')}`
  await page.setContent(`<body style="margin:0;background:#eee"><img alt="panel" style="display:block;width:840px;height:auto;margin:20px auto" src="${source}"></body>`)
  await page.screenshot({ path: 'output/vector-spike/panel-svg-render.png' })
  await page.setContent(`<body style="margin:0"><img alt="panel" style="display:block;width:1590px;height:1877px" src="${source}"></body>`)
  await page.locator('img').screenshot({ path: 'output/vector-spike/panel-svg-exact.png' })
  console.log('Rendered SVG preview to output/vector-spike/panel-svg-render.png')
} finally { await browser.close() }
