import { chromium } from 'playwright-core'
import { strict as assert } from 'node:assert'
import { readFile } from 'node:fs/promises'
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
try {
  const page = await browser.newPage({ acceptDownloads: true })
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: '新建项目', exact: true }).click()
  await page.getByLabel('新项目名称').fill(`SVG路径验证-${Date.now()}`)
  await page.getByRole('button', { name: '创建项目', exact: true }).click()
  await page.locator('.project-controls').waitFor()
  const input = page.getByLabel('导入SVG独立路径', { exact: true })
  await input.setInputFiles({ name: 'blocked.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><script>alert(1)</script></svg>') })
  await page.getByText('不支持script', { exact: false }).waitFor()
  await input.setInputFiles({ name: 'two-paths.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><path fill="#183d58" d="M10 10 L90 10 L90 90 L10 90 Z"/><path fill="#287acc" d="M110 10 L190 10 L150 90 Z"/></svg>') })
  await page.getByText('导入2个独立路径', { exact: false }).waitFor()
  assert.equal(await page.locator('.element-picks button').count(), 2)
  await page.getByRole('button', { name: '保存项目', exact: true }).click()
  await page.getByText('已保存到服务器', { exact: false }).waitFor()
  const id = await page.getByLabel('选择项目').inputValue()
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByLabel('选择项目').selectOption(id)
  await page.locator('.element-picks button').first().waitFor()
  assert.equal(await page.locator('.element-picks button').count(), 2)
  await page.locator('.element-picks button').first().click()
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: '下载选中元素 SVG', exact: true }).click()
  const file = await downloaded
  const svg = await readFile((await file.path())!, 'utf8')
  assert.ok(svg.includes('<path'))
  assert.ok(!svg.includes('<image'))
  assert.ok(svg.includes('width="400mm"'))
  console.log('PASS: rejected script; imported two independent paths; saved/reopened; exported one genuine path-only SVG at400mm')
} finally { await browser.close() }
