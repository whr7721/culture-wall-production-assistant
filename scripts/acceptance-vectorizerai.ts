// Integration acceptance with a simulated upstream. Never calls a paid API.
import { strict as assert } from 'node:assert'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import express from 'express'
import sharp from 'sharp'
import { chromium } from 'playwright-core'
import { config } from '../server/config.ts'
import { projectsRouter } from '../server/routes/projects.ts'
import { vectorizeRouter } from '../server/routes/vectorize.ts'

const temporary = await mkdtemp(path.join(tmpdir(), 'culture-wall-vectorizer-'))
const output = path.resolve('output/vectorizerai-acceptance')
await mkdir(output, { recursive: true })
const through302 = process.argv.includes('--302')
Object.assign(config, { projectsDir: path.join(temporary, 'projects'), vectorizerResultsDir: path.join(temporary, 'vectors'), vectorizerEnabled: true, vectorizerChannel: through302 ? '302' : 'official', vectorizer302ApiKey: 'integration-test-302-key', vectorizerApiId: 'integration-test-id', vectorizerApiSecret: 'integration-test-secret', vectorizerMode: through302 ? 'production' : 'test', vectorizerDailyBudget: .9, vectorizerTotalBudget: 1, vectorizerMinIntervalMs: 0 })
const fixture = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 60"><g fill="none" stroke="#1a2f7c" stroke-width="2"><circle cx="30" cy="30" r="20"/><path d="M70 10L105 30L70 50"/></g></svg>'
const nativeFetch = globalThis.fetch
let calls = 0
globalThis.fetch = async (url, init) => {
  if (!String(url).startsWith('https://api.vectorizer.ai/') && !String(url).startsWith('https://api.302.ai/vectorizer/')) return nativeFetch(url, init)
  calls++
  const body = init?.body as FormData
  assert.equal(body.get('mode'), through302 ? 'production' : 'test')
  if (through302) assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer integration-test-302-key')
  assert.equal(body.get('output.draw_style'), 'stroke_edges')
  assert.equal(body.get('processing.palette'), '#1a2f7c;#ffffff;')
  assert.equal(body.get('processing.max_colors'), '2')
  assert.equal(body.get('output.group_by'), 'parent')
  return new Response(fixture, { headers: { 'Content-Type': 'image/svg+xml', 'X-Credits-Charged': '0' } })
}
const app = express()
app.use((_req, res, next) => { res.locals.invite = { username: 'test-user' }; next() })
app.use('/api/projects', projectsRouter); app.use('/api/vectorize', vectorizeRouter)
app.get('/api/generations/models', (_req, res) => res.json({ models: [], defaultModel: '' }))
app.use(express.static(path.resolve('dist')))
app.get('*splat', (_req, res) => res.sendFile(path.resolve('dist/index.html')))
const server = app.listen(0, '127.0.0.1')
await new Promise<void>(resolve => server.once('listening', resolve))
const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
try {
  const page = await browser.newPage({ acceptDownloads: true, viewport: { width: 1400, height: 1000 } })
  page.on('dialog', dialog => void dialog.accept())
  await page.goto(origin, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: '新建项目', exact: true }).click()
  await page.getByLabel('新项目名称').fill('高质量描摹模拟全链路验收')
  await page.getByRole('button', { name: '创建项目', exact: true }).click()
  const png = await sharp(Buffer.from(fixture)).png().toBuffer()
  await page.locator('#projects input[type=file][accept="image/png,image/jpeg,image/webp"]').setInputFiles({ name: 'icons.png', mimeType: 'image/png', buffer: png })
  await page.getByLabel('添加图片素材').selectOption({ label: 'icons.png' })
  const extractor = page.locator('.vector-extractor')
  await extractor.getByLabel('描摹通道', { exact: true }).selectOption('vectorizerai')
  await extractor.getByRole('button', { name: '图标：描边', exact: true }).click()
  await extractor.getByLabel('锁色色板', { exact: true }).fill('#1a2f7c;#ffffff;')
  await extractor.getByLabel('最大颜色数', { exact: true }).fill('2')
  await extractor.getByLabel('描摹分组', { exact: true }).selectOption('parent')
  await extractor.getByRole('button', { name: '生成高质量 SVG', exact: true }).click()
  await extractor.getByText('已生成 2 个矢量轮廓', { exact: false }).waitFor()
  // Identical input reuses a persisted result rather than spending again.
  await extractor.getByRole('button', { name: '生成高质量 SVG', exact: true }).click()
  await extractor.getByText('复用已保存结果，未再次调用上游。', { exact: false }).waitFor()
  assert.equal(calls, 1)
  // Changing a parameter must not remove the previous paid download.
  await extractor.getByLabel('描摹分组', { exact: true }).selectOption('color')
  await extractor.getByRole('link', { name: through302 ? '下载完整 SVG' : '下载完整 SVG（测试水印）', exact: true }).waitFor()
  const downloadPromise = page.waitForEvent('download')
  await extractor.getByRole('link', { name: through302 ? '下载完整 SVG' : '下载完整 SVG（测试水印）', exact: true }).click()
  const downloaded = await downloadPromise
  assert.equal(await downloaded.failure(), null, `download ${downloaded.url()} failed: ${await downloaded.failure()}`)
  const svg = await readFile((await downloaded.path())!, 'utf8')
  assert(svg.includes('<path')); assert(!svg.includes('<image')); assert(svg.includes('stroke="#1a2f7c"'))
  await writeFile(path.join(output, 'simulated-upstream-result.svg'), svg)
  await extractor.getByRole('button', { name: '加入选中图层（2 个轮廓）', exact: true }).click()
  await page.getByText('已加入 2 个可编辑轮廓', { exact: false }).waitFor()
  assert.equal(await page.locator('.element-picks button').count(), 3)
  // The circle center must stay white: Fabric cannot use the SVG literal "none" as Canvas fillStyle.
  await page.waitForFunction(() => {
    const canvas = document.querySelector('#projects canvas.lower-canvas') as HTMLCanvasElement | null
    if (!canvas?.width) return false
    const scale = canvas.width / 3500
    const pixel = canvas.getContext('2d')!.getImageData(Math.round(225 * scale), Math.round(300 * scale), 1, 1).data
    return pixel[0] > 240 && pixel[1] > 240 && pixel[2] > 240
  })
  await page.getByRole('button', { name: '保存项目', exact: true }).click()
  await page.getByText('已保存到服务器', { exact: false }).waitFor()
  const id = await page.getByLabel('选择项目').inputValue()
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByLabel('选择项目').selectOption(id)
  await page.locator('.element-picks button').last().waitFor()
  assert.equal(await page.locator('.element-picks button').count(), 3)
  // Refresh then recover from the server task list, with no upstream request.
  await page.locator('.element-picks button').first().click()
  await page.locator('.vector-task-history summary').click()
  await page.getByRole('button', { name: '恢复结果／查看状态', exact: true }).click()
  await page.locator('.vector-extractor').getByRole('link', { name: through302 ? '下载完整 SVG' : '下载完整 SVG（测试水印）', exact: true }).waitFor()
  assert.equal(calls, 1)
  await page.locator('.element-picks button').last().click()
  await page.getByLabel('描边颜色', { exact: true }).fill('#224466')
  const elementDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: '下载选中元素 SVG', exact: true }).click()
  const asset = await elementDownload
  const element = await readFile((await asset.path())!, 'utf8')
  assert(element.includes('<path')); assert(element.includes('stroke="#224466"')); assert(element.includes('fill="none"')); assert(!element.includes('<image'))
  await writeFile(path.join(output, 'independent-path.svg'), element)
  await page.screenshot({ path: path.join(output, 'workspace.png'), fullPage: true })
  assert.equal(calls, 1)
  await writeFile(path.join(output, through302 ? 'report-302.json' : 'report.json'), JSON.stringify({ upstream: 'simulated; no external API called', channel: through302 ? '302' : 'official', mode: config.vectorizerMode, calls, stages: ['upload', 'official parameter mapping', 'SVG sanitization', 'protected stored download', 'path import', 'save', 'reopen', 'independent SVG export'], projectStorage: temporary }, null, 2))
  console.log(`PASS: simulated ${through302 ? '302' : 'official test-mode'} upload -> download -> editable paths -> save/reopen -> independent SVG export; zero paid calls`)
} finally {
  globalThis.fetch = nativeFetch
  await browser.close()
  await new Promise<void>(resolve => server.close(() => resolve()))
}
