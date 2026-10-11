import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { chromium } from 'playwright-core'

if (process.env.ALLOW_PAID_KIMI_TEST !== '1') throw new Error('Set ALLOW_PAID_KIMI_TEST=1 to authorize one paid request.')
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true })
try {
  const page = await browser.newPage({ acceptDownloads: true })
  let imageCalls = 0
  await page.route('**/api/generations', async (route) => { imageCalls++; await route.abort() })
  await page.goto('http://127.0.0.1:5173', { waitUntil: 'networkidle' })
  await page.locator('#prompt').fill('为专颜媄肤设计3500毫米宽、2300毫米高的文化墙，底下有桌子但高度未知。透明亚克力，深蓝字体，医疗感克制。品牌故事、八项承诺、塑美流程、养护技巧全部保留。若有参考图，只用于风格分析，不是客户原始Logo；准确Logo须以后上传原件，不得擅自重画。')
  const logo = process.env.KIMI_TEST_REFERENCE
  if (logo && existsSync(logo)) await page.locator('input[type=file]').first().setInputFiles(logo)
  await page.locator('.planner-panel summary').click()
  await page.getByLabel('整理需求墙宽').fill('3500')
  await page.getByLabel('整理需求墙高').fill('2300')
  const copy = '专颜媄肤\n成立于2019年，以专业、安全、自然为核心理念，致力于为求美者提供科学定制化的高品质皮肤管理服务。我们相信，真正的美源于对细节的坚持以及对每一位顾客的真诚关怀。\n塑美流程：咨询预约、专业面诊、制定方案、安心调理、术后关怀。\n我们的承诺Our Prosime\n01 ONE 皮肤检测 精准量肤 有效评估\n02 TWO 辩证分型 因人施方 科学搭配\n03 THREE 实时跟踪 全程指导 效果见证\n04 FOUR 科学配方 不含铅汞 激素 抗生素 等\n05 FIVE 倾心呵护 长效保持 健康稳定\n06 SIX 无添加 无人工香精矿物油.荧光剂\n07 SEVEN 客服随访 一对一跟效果随时答疑\n08 EIGHT 安全可靠 国家食品药品监督局备案\n皮肤养护技巧：定期补水、合理饮食、防晒保护、正确护肤、保证睡眠。'
  await page.locator('#planner-copy').fill(copy)
  await page.getByLabel(/我有权将这些文案/).check()
  const responseEvent = page.waitForResponse((response) => response.url().endsWith('/api/planner') && response.request().method() === 'POST', { timeout: 110000 })
  await page.getByRole('button', { name: '整理需求与提示词', exact: true }).click()
  const response = await responseEvent
  const body = await response.json()
  assert.equal(response.status(), 200, body.error)
  assert.equal(body.source.widthMm, 3500)
  assert.equal(body.source.heightMm, 2300)
  assert.equal(body.source.exactCopy.replace(/\r\n/g, '\n'), copy)
  await page.locator('#planner-output').waitFor()
  const downloadEvent = page.waitForEvent('download')
  await page.getByRole('button', { name: '下载整理记录与原文' }).click()
  const download = await downloadEvent
  await mkdir('output/kimi-live', { recursive: true })
  await download.saveAs('output/kimi-live/需求整理.json')
  await page.getByRole('button', { name: '已核对，填入上方需求（不会自动生成）', exact: true }).click()
  assert.equal(await page.locator('#prompt').inputValue(), body.imagePrompt)
  assert.equal(imageCalls, 0)
  await page.screenshot({ path: 'output/kimi-live/本地验收.png', fullPage: true })
  console.log(JSON.stringify({ passed: true, referenceUploaded: Boolean(logo && existsSync(logo)), model: body.model, summary: body.summary, questions: body.questions, warnings: body.warnings, imagePrompt: body.imagePrompt, imageCalls }, null, 2))
} finally { await browser.close() }
