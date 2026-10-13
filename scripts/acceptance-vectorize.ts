import { strict as assert } from 'node:assert'
import { readFile, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { chromium } from 'playwright-core'
import { traceMaskToSvg } from '../server/services/vectorize.ts'

const input = await readFile('output/vector-spike/panel-isolated.png')
const result = await traceMaskToSvg(input)
assert.equal(result.pathCount, 1)
assert.doesNotMatch(result.svg, /<image\b|data:image/)
const output = 'output/vector-spike/panel-website-trace.svg'
await writeFile(output, result.svg, 'utf8')

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
try {
  const page = await browser.newPage()
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' })
  const imported = await page.evaluate(async ({ svg }) => {
    const { importSvgPaths } = await import('/src/lib/importSvg.ts')
    const elements = await importSvgPaths(svg, 1590)
    return elements.map((item) => ({ kind: item.kind, width: item.width, height: item.height }))
  }, { svg: result.svg })
  assert.equal(imported.length, 1)
  assert.equal(imported[0].kind, 'path')
  assert(imported[0].width > 1000 && imported[0].width <= 1590)
} finally { await browser.close() }

const inkscape = spawnSync('C:/Program Files/Inkscape/bin/inkscape.exe', [output, '--query-all'], { encoding: 'utf8' })
assert.equal(inkscape.status, 0, inkscape.stderr)
assert.match(inkscape.stdout, /path/)
console.log(`PASS: ${result.pathCount} editable SVG path; browser import and Inkscape query succeeded; ${output}`)
