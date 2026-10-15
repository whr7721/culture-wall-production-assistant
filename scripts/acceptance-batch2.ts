// Isolated browser acceptance. No production data and no external paid API calls.
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import express from 'express'
import sharp from 'sharp'
import { chromium } from 'playwright-core'
import { readPsd, initializeCanvas } from 'ag-psd'
import { config } from '../server/config.ts'
import { projectsRouter } from '../server/routes/projects.ts'
import { vectorizeRouter } from '../server/routes/vectorize.ts'

const temporary = await mkdtemp(path.join(os.tmpdir(), 'wall-batch2-'))
Object.assign(config, { projectsDir: path.join(temporary, 'projects'), vectorizerResultsDir: path.join(temporary, 'vectors'), projectActiveLimit: 20, vectorizerDailyBudget: 0, vectorizerTotalBudget: 0 })
const out = path.resolve('output/batch2-acceptance'); await mkdir(out, { recursive: true })
const app = express()
app.use((_req, res, next) => { res.locals.invite = { username: 'test-user' }; next() })
app.use('/api/projects', projectsRouter); app.use('/api/vectorize', vectorizeRouter)
app.get('/api/generations/models', (_req, res) => res.json({ models: [], defaultModel: '' }))
app.use('/api', (_req, res) => res.status(404).json({ error: 'disabled in acceptance' }))
app.use(express.static(path.resolve('dist')))
const server = app.listen(0, '127.0.0.1'); await new Promise<void>(r => server.once('listening', r))
const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const json = (body: unknown, method = 'POST') => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true })
  const pageErrors: string[] = []; page.on('pageerror', e => pageErrors.push(e.message))
  page.on('dialog', dialog => void dialog.accept())
  await page.goto(origin, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: '新建项目', exact: true }).click()
  await page.getByLabel('新项目名称').fill('草稿A')
  await page.getByRole('button', { name: '创建项目', exact: true }).click()
  await page.locator('.project-controls').waitFor()
  const a = await page.getByLabel('选择项目', { exact: true }).inputValue()
  const title = page.locator('.project-controls > label').first().locator('input')
  await title.fill('草稿A-未保存')
  await page.getByRole('button', { name: '新建项目', exact: true }).click()
  await page.getByLabel('新项目名称').fill('草稿B')
  await page.getByRole('button', { name: '创建项目', exact: true }).click()
  await page.waitForFunction(id => (document.querySelector('select[aria-label="选择项目"]') as HTMLSelectElement)?.value !== id, a)
  await page.getByLabel('选择项目', { exact: true }).selectOption(a)
  await page.waitForFunction(() => (document.querySelector('.project-controls > label input') as HTMLInputElement)?.value === '草稿A-未保存')
  await title.fill('撤销测试')
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  assert.equal(await title.inputValue(), '草稿A-未保存')
  await page.getByRole('button', { name: '重做', exact: true }).click()
  assert.equal(await title.inputValue(), '撤销测试')
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByLabel('选择项目', { exact: true }).selectOption(a)
  await page.waitForFunction(() => (document.querySelector('.project-controls > label input') as HTMLInputElement)?.value === '撤销测试')
  await page.getByRole('button', { name: '保存项目', exact: true }).click()
  await page.getByText('已保存到服务器', { exact: false }).waitFor()
  // An update in another window must not destroy this window's draft.
  const latest = await (await fetch(`${origin}/api/projects/${a}`)).json()
  await title.fill('冲突草稿保留')
  assert.equal((await fetch(`${origin}/api/projects/${a}`, json({ ...latest, title: '另一窗口更新' }, 'PUT'))).status, 200)
  await page.getByRole('button', { name: '保存项目', exact: true }).click()
  await page.getByText('另一窗口已更新项目', { exact: false }).waitFor()
  assert.equal(await title.inputValue(), '冲突草稿保留')
  await page.reload({ waitUntil: 'networkidle' }); await page.getByLabel('选择项目', { exact: true }).selectOption(a)
  await page.waitForFunction(() => (document.querySelector('.project-controls > label input') as HTMLInputElement)?.value === '冲突草稿保留')
  await page.getByRole('button', { name: '保存项目', exact: true }).click()
  await page.getByText('已保存到服务器', { exact: false }).waitFor()
  await page.getByRole('button', { name: '归档项目', exact: true }).click()
  await page.getByRole('button', { name: '恢复项目', exact: true }).waitFor()
  await page.getByRole('button', { name: '恢复项目', exact: true }).click()
  await page.getByRole('button', { name: '归档项目', exact: true }).waitFor()

  // SVG physical dimensions are shown before insertion.
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="50mm" viewBox="0 0 200 100"><path d="M0 0H200V100H0Z" fill="#123456"/></svg>'
  await page.getByLabel('导入SVG独立路径').setInputFiles({ name: '100mm.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(svg) })
  await page.getByLabel('导入宽 mm').waitFor()
  assert.equal(await page.getByLabel('导入宽 mm').inputValue(), '100')
  assert.equal(await page.getByLabel('导入高 mm').inputValue(), '50')
  await page.getByRole('button', { name: '确认导入尺寸', exact: true }).click()
  await page.locator('.element-picks button').first().waitFor()
  await page.getByRole('button', { name: '保存项目', exact: true }).click()
  await page.getByText('已保存到服务器', { exact: false }).waitFor()
  const checked = await (await fetch(`${origin}/api/projects/${a}`)).json()
  assert.equal(checked.elements[0].width, 100); assert.equal(checked.elements[0].height, 50)

  // The legacy stretch fixture must occupy the same box in every export.
  let p = await (await fetch(`${origin}/api/projects`, json({ title: '导出一致性夹具' }))).json()
  const png = await sharp({ create: { width: 200, height: 100, channels: 3, background: '#ff0000' } }).png().toBuffer()
  const form = new FormData(); form.set('revision', String(p.revision)); form.set('asset', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'red-2to1.png')
  p = (await (await fetch(`${origin}/api/projects/${p.id}/assets`, { method: 'POST', body: form })).json()).project
  p = await (await fetch(`${origin}/api/projects/${p.id}`, json({ ...p, widthMm: 1000, heightMm: 1000, measurementStatus: 'confirmed', status: 'approved', elements: [
    { id: crypto.randomUUID(), kind: 'image', assetId: p.assets[0].id, x: 100, y: 100, width: 400, height: 400, label: 'legacy-stretch' },
    { id: crypto.randomUUID(), kind: 'text', x: 600, y: 100, width: 130, height: 400, text: '上海欧连电子科技有限公司\nACH precise copy with wrapping', fontSizeMm: 30, color: '#123456' },
  ] }, 'PUT'))).json()
  assert.equal(p.status, 'approved')
  await page.reload({ waitUntil: 'networkidle' }); await page.getByLabel('选择项目', { exact: true }).selectOption(p.id)
  await page.locator('.element-picks button').first().waitFor()
  const files: Record<string, string> = {}
  for (const [kind, label] of [['svg', '下载 SVG'], ['png', '下载 PNG'], ['psd', '下载分层 PSD']]) {
    const event = page.waitForEvent('download'); await page.getByRole('button', { name: label, exact: true }).click()
    const file = await event; files[kind] = path.join(out, `consistency.${kind}`); await file.saveAs(files[kind])
  }
  const svgOut = await readFile(files.svg, 'utf8')
  assert(svgOut.includes('preserveAspectRatio="none"')); assert((svgOut.match(/<tspan/g) || []).length > 4)
  const flattened = await readFile(files.png)
  const pixel = await sharp(flattened).extract({ left: 200, top: 750, width: 1, height: 1 }).removeAlpha().raw().toBuffer()
  assert(pixel[0] > 240 && pixel[1] < 10)
  const rendered = await page.evaluate(async (source) => {
    const image = new Image(); image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`; await image.decode()
    const c = document.createElement('canvas'); c.width = c.height = 1600; c.getContext('2d')!.drawImage(image, 0, 0, 1600, 1600)
    return c.toDataURL('image/png').split(',')[1]
  }, svgOut)
  const svgPixels = await sharp(Buffer.from(rendered, 'base64')).ensureAlpha().raw().toBuffer()
  const pngPixels = await sharp(flattened).ensureAlpha().raw().toBuffer()
  let different = 0
  for (let i = 0; i < svgPixels.length; i += 4) if ([0, 1, 2].some(j => Math.abs(svgPixels[i + j] - pngPixels[i + j]) > 20)) different++
  assert(different / (1600 * 1600) < .005, `SVG/PNG difference too large: ${different}`)
  initializeCanvas(() => { throw new Error('unexpected canvas allocation') }, (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4), colorSpace: 'srgb' }))
  const psd = readPsd(await readFile(files.psd), { useImageData: true, skipThumbnail: true })
  assert.equal(psd.children?.length, 3); assert.equal(psd.width, 1600)
  assert(psd.imageData)
  const psdData = psd.imageData!.data
  assert(psdData[(750 * 1600 + 200) * 4] > 240 && psdData[(750 * 1600 + 200) * 4 + 1] < 10)
  let psdDifferent = 0
  for (let i = 0; i < pngPixels.length; i += 4) if ([0, 1, 2].some(j => Math.abs(psdData[i + j] - pngPixels[i + j]) > 20)) psdDifferent++
  assert.equal(psdDifferent, 0, 'PSD composite differs from PNG')
  // Default aspect ratio when adding a new image object.
  await page.getByLabel('添加图片素材', { exact: true }).selectOption({ label: 'red-2to1.png' })
  await page.getByRole('button', { name: '保存项目', exact: true }).click()
  await page.getByText('已保存到服务器', { exact: false }).waitFor()
  const ratioProject = await (await fetch(`${origin}/api/projects/${p.id}`)).json()
  assert.equal(ratioProject.elements.at(-1).width / ratioProject.elements.at(-1).height, 2)
  await page.locator('.element-picks button').first().click()
  await page.getByLabel('描摹通道', { exact: true }).selectOption('vectorizerai')
  await page.setViewportSize({ width: 375, height: 850 }); await page.screenshot({ path: path.join(out, 'mobile.png'), fullPage: true })
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'mobile page horizontally overflows')
  const notes = await page.locator('.tiny-note,.field-help,.result-note,.validation-copy').filter({ visible: true }).count()
  assert(notes <= 12, `${notes} default explanation blocks`)
  assert.equal(pageErrors.length, 0, pageErrors.join('\n'))
  await writeFile(path.join(out, 'report.json'), JSON.stringify({ paidCalls: 0, temporary, checks: ['draft switch/reload', 'conflict draft recovery', 'undo/redo', 'archive/restore', 'SVG physical units', 'SVG/PNG pixel consistency', 'PSD layers and composite', 'image aspect', '375px overflow with cloud panel', 'default explanation count'], visibleNotes: notes, svgPngDifferentPixels: different, psdPngDifferentPixels: psdDifferent }, null, 2))
  console.log('PASS batch2; no paid calls; default notes:', notes, 'SVG/PNG different pixels:', different)
} finally { await browser.close(); await new Promise<void>(r => server.close(() => r())) }
