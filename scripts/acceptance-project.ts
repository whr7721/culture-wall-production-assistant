import { mkdtemp, readFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { chromium } from 'playwright-core'
import { readPsd } from 'ag-psd'

const browserPath = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const baseUrl = process.env.TRIAL_URL || 'http://127.0.0.1:18081'
const browser = await chromium.launch({ executablePath: browserPath, headless: true })
try {
  const context = await browser.newContext({ acceptDownloads: true })
  const page = await context.newPage()
  await page.goto(baseUrl, { waitUntil: 'networkidle' })
  page.once('dialog', (dialog) => dialog.accept('浏览器验收项目'))
  await page.getByRole('button', { name: '新建项目' }).click()
  await page.locator('.project-controls').waitFor()
  await page.getByLabel('墙宽 mm').fill('3500')
  await page.getByLabel('墙高 mm').fill('2300')
  await page.getByLabel('尺寸已现场复尺').check()
  await page.getByRole('button', { name: '添加文字' }).click()
  await page.locator('.element-picks button').first().click()
  await page.locator('.selected-editor textarea').fill('准确文案')
  await page.getByRole('button', { name: '保存项目' }).click()
  await page.getByText('已保存到服务器').waitFor()
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByLabel('选择项目').selectOption({ label: '浏览器验收项目 · 草稿' })
  await page.getByRole('button', { name: '确认平面稿' }).click()
  await page.getByText('平面稿已确认').waitFor()
  const directory = await mkdtemp(path.join(os.tmpdir(), 'culture-wall-accept-'))
  const svgEvent = page.waitForEvent('download')
  await page.getByRole('button', { name: '下载 SVG' }).click()
  const svg = await svgEvent
  const svgPath = path.join(directory, 'draft.svg')
  await svg.saveAs(svgPath)
  const svgContent = await readFile(svgPath, 'utf8')
  if (!svgContent.includes('准确文案') || !svgContent.includes('3500mm')) throw new Error('SVG 内容或实测尺寸缺失')
  const psdEvent = page.waitForEvent('download')
  await page.getByRole('button', { name: '下载分层 PSD' }).click()
  const psd = await psdEvent
  const psdPath = path.join(directory, 'draft.psd')
  await psd.saveAs(psdPath)
  const parsed = readPsd(await readFile(psdPath), { skipLayerImageData: true, skipCompositeImageData: true })
  if (parsed.children?.length !== 2 || parsed.width !== 1600) throw new Error('PSD 分层或尺寸异常')
  console.log('项目验收通过：新建→实测尺寸→编辑→保存重开→确认→SVG/PSD 导出与结构解析。')
} finally { await browser.close() }
