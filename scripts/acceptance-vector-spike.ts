import { chromium } from 'playwright-core'
import { strict as assert } from 'node:assert'
import { readFile } from 'node:fs/promises'

const specimen = await readFile('output/vector-spike/divider-importable.svg')
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
try {
  const page = await browser.newPage({ acceptDownloads: true })
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: '新建项目', exact: true }).click()
  await page.getByLabel('新项目名称').fill(`描摹小样-${Date.now()}`)
  await page.getByRole('button', { name: '创建项目', exact: true }).click()
  await page.getByLabel('导入SVG独立路径', { exact: true }).setInputFiles({
    name: 'divider-importable.svg', mimeType: 'image/svg+xml', buffer: specimen,
  })
  await page.getByText('导入1个独立路径', { exact: false }).waitFor()
  assert.equal(await page.locator('.element-picks button').count(), 1)
  await page.getByRole('button', { name: '保存项目', exact: true }).click()
  await page.getByText('已保存到服务器', { exact: false }).waitFor()
  const id = await page.getByLabel('选择项目').inputValue()
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByLabel('选择项目').selectOption(id)
  await page.locator('.element-picks button').first().waitFor()
  const download = page.waitForEvent('download')
  await page.locator('.element-picks button').first().click()
  await page.getByRole('button', { name: '下载选中元素 SVG', exact: true }).click()
  const file = await download
  const output = await readFile((await file.path())!, 'utf8')
  assert.match(output, /<path\b/)
  assert.doesNotMatch(output, /<image\b/)
  console.log(`PASS: traced real divider imported, saved/reopened and exported path-only SVG; project=${id}`)
} finally {
  await browser.close()
}
