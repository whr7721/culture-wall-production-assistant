import { strict as assert } from 'node:assert'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import express from 'express'
import sharp from 'sharp'
import { chromium } from 'playwright-core'
import { elementSvg } from '../shared/elementSvg.ts'
import { traceColorLayers } from '../server/services/vectorize.ts'

const output = path.resolve('output/color-layer-acceptance')
await mkdir(output, { recursive: true })
// Dedicated project storage: this test never edits or deletes user projects.
process.env.PROJECTS_DIR = await mkdtemp(path.join(tmpdir(), 'culture-wall-layers-'))
const { projectsRouter } = await import('../server/routes/projects.ts')
const { vectorizeRouter } = await import('../server/routes/vectorize.ts')
const app = express()
app.use((_req, res, next) => { res.locals.invite = { username: 'test-user' }; next() })
app.use('/api/projects', projectsRouter)
app.use('/api/vectorize', vectorizeRouter)
const server = app.listen(0, '127.0.0.1')
await new Promise<void>((resolve) => server.once('listening', resolve))
const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const report: Record<string, unknown> = { projectStorage: process.env.PROJECTS_DIR, svgImports: [] }
try {
  const page = await browser.newPage({ acceptDownloads: true, viewport: { width: 1400, height: 1100 } })
  await page.route(/\/api\/(projects|vectorize)(\/|$|\?)/, async (route) => {
    const url = new URL(route.request().url())
    const response = await route.fetch({ url: origin + url.pathname + url.search })
    await route.fulfill({ response })
  })
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' })

  // Previously rejected real SVGs: namespaces, inherited paint and transforms.
  for (const name of ['vtracer', 'potrace', 'layers', 'finalRecraftSvg', 'ultimateVectorizerSvg']) {
    const svg = await readFile(`D:/codex/rea-analysis/ziheng-svg-20261013/output-${name}.svg`, 'utf8')
    const elements = await page.evaluate(async (source) => {
      const { importSvgPaths } = await import('/src/lib/importSvg.ts')
      return await importSvgPaths(source, 128)
    }, svg)
    assert(elements.length > 0)
    const restored = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">${elements.map((item) => `<g transform="translate(${item.x} ${item.y})">${elementSvg(item).replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')}</g>`).join('')}</svg>`
    // Browser rendering accepts namespace-prefixed SVG roots as well as regular svg.
    const render = (source: string) => page.evaluate(async (source) => {
      const url = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml' }))
      try {
        const image = new Image(); image.src = url; await image.decode()
        const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 128
        const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 128, 128)
        ctx.drawImage(image, 0, 0, 128, 128)
        return Array.from(ctx.getImageData(0, 0, 128, 128).data)
      } finally { URL.revokeObjectURL(url) }
    }, source)
    const [a, b] = await Promise.all([render(svg), render(restored)])
    const error = a.reduce((sum, pixel, i) => sum + Math.abs(pixel - b[i]), 0) / a.length
    assert(error < 8, `${name}: mean pixel error ${error}`)
    ;(report.svgImports as unknown[]).push({ name, paths: elements.length, meanPixelError: error })
    await writeFile(path.join(output, `${name}-roundtrip.svg`), restored)
  }
  // Reject executable SVG and verify even-odd holes survive the object model.
  const safe = await page.evaluate(async () => {
    const { importSvgPaths } = await import('/src/lib/importSvg.ts')
    let rejected = false
    try { await importSvgPaths('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path onload="alert(1)" d="M0 0H20V20H0Z"/></svg>', 20) } catch { rejected = true }
    const [hole] = await importSvgPaths('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><g transform="translate(10 10) scale(2)"><path fill-rule="evenodd" d="M0 0H30V30H0Z M5 5H25V25H5Z"/></g></svg>', 100)
    return { rejected, hole }
  })
  assert(safe.rejected); assert.equal(safe.hole.fillRule, 'evenodd'); assert.equal(safe.hole.x, 10); assert.equal(safe.hole.width, 60)

  const png = await sharp(Buffer.from('<svg width="128" height="128"><rect width="128" height="128" fill="white"/><path d="M16 16H59V113H16Z" fill="#dc2828"/><circle cx="92" cy="50" r="25" fill="#1e64e6"/></svg>')).png().toBuffer()
  await page.getByRole('button', { name: '新建项目', exact: true }).click()
  await page.getByLabel('新项目名称').fill('颜色分层独立验收')
  await page.getByRole('button', { name: '创建项目', exact: true }).click()
  await page.locator('#projects input[type=file][accept="image/png,image/jpeg,image/webp"]').setInputFiles({ name: 'red-blue.png', mimeType: 'image/png', buffer: png })
  await page.getByText('素材已上传', { exact: false }).waitFor()
  const assetId = await page.getByLabel('添加图片素材').locator('option').nth(1).getAttribute('value')
  await page.getByLabel('添加图片素材').selectOption(assetId!)
  const crop = page.getByLabel('拖动框选图片区域')
  await crop.scrollIntoViewIfNeeded()
  const box = (await crop.boundingBox())!
  await page.mouse.move(box.x + box.width * .1, box.y + box.height * .1)
  await page.mouse.down(); await page.mouse.move(box.x + box.width * .95, box.y + box.height * .95, { steps: 8 }); await page.mouse.up()
  await page.getByLabel('主要颜色数').selectOption('3')
  await page.getByRole('button', { name: '生成分层预览', exact: true }).click()
  await page.getByText('生成 3 个颜色层', { exact: false }).waitFor({ timeout: 40_000 })
  assert.equal(await page.locator('.vector-layer').count(), 3)
  assert.equal(await page.locator('.vector-layer input:checked').count(), 2)
  await page.getByLabel('保留原图对象作对照').uncheck()
  await page.screenshot({ path: path.join(output, 'layer-preview.png'), fullPage: true })
  await page.getByRole('button', { name: /加入选中图层/ }).click()
  await page.getByText('已加入 2 个可编辑轮廓', { exact: false }).waitFor()
  await page.getByRole('button', { name: '保存项目', exact: true }).click()
  await page.getByText('已保存到服务器', { exact: false }).waitFor()
  const projectId = await page.getByLabel('选择项目').inputValue()
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByLabel('选择项目').selectOption(projectId)
  await page.locator('.element-picks button').first().waitFor()
  assert.equal(await page.locator('.element-picks button').count(), 2)
  for (const [index, button] of (await page.locator('.element-picks button').all()).entries()) {
    await button.click()
    const pending = page.waitForEvent('download')
    await page.getByRole('button', { name: '下载选中元素 SVG', exact: true }).click()
    const download = await pending
    const svg = await readFile((await download.path())!, 'utf8')
    assert.match(svg, /<path\b/); assert.doesNotMatch(svg, /<image\b/); assert.match(svg, /width="[0-9.]+mm"/)
    await writeFile(path.join(output, `element-${index + 1}.svg`), svg)
  }
  await page.getByLabel('尺寸已现场复尺').check()
  await page.getByRole('button', { name: '确认平面稿', exact: true }).click()
  await page.getByText('平面稿已确认', { exact: false }).waitFor()
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: '下载 SVG', exact: true }).click()
  const full = await readFile((await (await pending).path())!, 'utf8')
  assert.equal((full.match(/<path\b/g) || []).length, 2); assert.doesNotMatch(full, /<image\b/)
  await writeFile(path.join(output, 'combined-project.svg'), full)
  report.browser = 'crop → 3 colour previews → select 2 foreground layers → save/reopen → individual and combined SVG downloads passed'

  const real = await sharp('D:/codex/culture-wall-skilled-4766x2690.png').extract({ left: 115, top: 300, width: 1725, height: 2010 }).png().toBuffer()
  const realResult = await traceColorLayers(real, 4)
  const realSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${realResult.width}" height="${realResult.height}" viewBox="0 0 ${realResult.width} ${realResult.height}">${realResult.layers.map((layer) => layer.svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')).join('')}</svg>`
  const realPaths = await page.evaluate(async (source) => {
    const { importSvgPaths } = await import('/src/lib/importSvg.ts')
    return await importSvgPaths(source, 1000)
  }, realSvg)
  assert.equal(realPaths.length, realResult.pathCount)
  report.realCase = { colors: realResult.layers.map((layer) => ({ color: layer.color, paths: layer.pathCount, background: layer.background })), warnings: realResult.warnings, importedPaths: realPaths.length, sizeNote: 'Import test uses arbitrary 1000mm width; crop physical size has not been measured.' }
  await writeFile(path.join(output, 'ach-combined.svg'), realSvg)
  await sharp(Buffer.from(realSvg)).resize({ height: 900 }).png().toFile(path.join(output, 'ach-vector-preview.png'))
  await sharp(real).resize({ height: 900 }).png().toFile(path.join(output, 'ach-source-preview.png'))
  for (const layer of realResult.layers) await writeFile(path.join(output, `ach-${layer.id}.svg`), layer.svg)
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
} finally {
  await browser.close()
  await new Promise<void>((resolve) => server.close(() => resolve()))
}
