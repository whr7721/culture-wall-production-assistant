// Reuses the already-paid result. No vectorization request is made here.
import { chromium } from 'playwright-core'
import { strict as assert } from 'node:assert'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
const output = path.resolve('output/vectorizerai-live-20261014-svg-fixed')
const result = JSON.parse(await readFile(path.join(output, 'result.json'), 'utf8'))
await sharp(Buffer.from(result.svg)).resize(600, 612).flatten({ background: '#ffffff' }).png().toFile(path.join(output, 'result-preview-white.png'))
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
try {
  const page = await browser.newPage({ acceptDownloads: true, viewport: { width: 1400, height: 1000 } })
  await page.route('**/api/vectorize/high-quality', route => route.abort())
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' })
  const rows = await (await fetch('http://127.0.0.1:8787/api/projects')).json()
  const existing = rows.find((row: { title: string }) => row.title === '302真实测试-心形图标-20261014')
  if (existing) await page.getByLabel('选择项目').selectOption(existing.id)
  else {
    await page.getByRole('button', { name: '新建项目', exact: true }).click()
    await page.getByLabel('新项目名称').fill('302真实测试-心形图标-20261014')
    await page.getByRole('button', { name: '创建项目', exact: true }).click()
  }
  await page.getByLabel('导入SVG独立路径', { exact: true }).waitFor()
  await page.getByLabel('导入SVG独立路径', { exact: true }).setInputFiles(path.join(output, 'result.svg'))
  await page.waitForTimeout(500)
  console.log('Import status:', await page.locator('.workspace-message').textContent())
  await page.getByText(`导入${result.pathCount}个独立路径`, { exact: false }).waitFor()
  assert.equal(await page.locator('.element-picks button').count(), result.pathCount)
  await page.getByRole('button', { name: '保存项目', exact: true }).click()
  await page.getByText('已保存到服务器', { exact: false }).waitFor()
  const id = await page.getByLabel('选择项目').inputValue()
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByLabel('选择项目').selectOption(id)
  await page.locator('.element-picks button').last().waitFor()
  assert.equal(await page.locator('.element-picks button').count(), result.pathCount)
  await page.locator('.element-picks button').last().click()
  await page.getByLabel('描边颜色', { exact: true }).fill('#11147d')
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: '下载选中元素 SVG', exact: true }).click()
  const downloaded = await pending
  const svg = await readFile((await downloaded.path())!, 'utf8')
  assert(svg.includes('stroke="#11147d"') && svg.includes('fill="none"'))
  await writeFile(path.join(output, 'edited-heart-element.svg'), svg)
  await page.getByRole('button', { name: '保存项目', exact: true }).click()
  await page.getByText('已保存到服务器', { exact: false }).waitFor()
  await writeFile(path.join(output, 'workspace-report.json'), JSON.stringify({ projectId: id, title: '302真实测试-心形图标-20261014', paths: result.pathCount, saved: true, reopened: true, strokeEdited: true, independentSvgDownloaded: true, additionalPaidCalls: 0 }, null, 2))
  await page.screenshot({ path: path.join(output, 'workspace.png'), fullPage: true })
  console.log(JSON.stringify({ projectId: id, paths: result.pathCount, saved: true, reopened: true, independentSvgDownloaded: true, additionalPaidCalls: 0 }))
} finally { await browser.close() }
