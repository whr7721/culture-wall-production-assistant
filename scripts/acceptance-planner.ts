import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'

// 所有 Kimi/生图接口均拦截为模拟结果，不产生费用。
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true })
const baseUrl = process.env.PLANNER_TEST_URL || 'http://127.0.0.1:8799'
try {
  const page = await browser.newPage({ acceptDownloads: true })
  let planningCalls = 0
  let imageCalls = 0
  await page.route('**/api/planner/status', (route) => route.fulfill({ json: { available: true, model: 'test-model' } }))
  await page.route('**/api/generations/models', (route) => route.fulfill({ json: { models: [{ id: 'default', label: '模拟生图', available: true, detail: '仅测试' }] } }))
  await page.route('**/api/generations', async (route) => { imageCalls++; await route.fulfill({ status: 500, json: { error: '不应调用' } }) })
  await page.route('**/api/planner', async (route) => {
    planningCalls++
    const body = route.request().postData() || ''
    assert.ok(body.includes('专颜媄肤'))
    assert.ok(body.includes('3500'))
    await route.fulfill({ json: {
      summary: '保留品牌故事和八项承诺', zones: [{ title: '品牌故事', content: '左侧布局' }], questions: ['Our Prosime 是否需要纠正？'], warnings: ['汉字必须核对'], imagePrompt: '设计米白深蓝文化墙正视候选图，分区清晰，保留原始 Logo。',
      source: { brief: '为专颜媄肤设计一面医疗风格文化墙', exactCopy: '专颜媄肤\nOur Prosime', widthMm: 3500, heightMm: 2300 }, model: 'test-model', instructionVersion: 'culture-wall-planner-v1',
    } })
  })
  await page.goto(baseUrl, { waitUntil: 'networkidle' })
  await page.locator('.planner-panel summary').click()
  const planButton = page.getByRole('button', { name: '整理需求与提示词', exact: true })
  assert.ok(await planButton.isDisabled())
  await page.locator('#prompt').fill('为专颜媄肤设计一面医疗风格文化墙')
  await page.getByLabel('整理需求墙宽').fill('3500')
  await page.getByLabel('整理需求墙高').fill('2300')
  await page.locator('#planner-copy').fill('专颜媄肤\nOur Prosime')
  assert.ok(await planButton.isDisabled())
  await page.getByLabel(/我有权将这些文案/).check()
  await planButton.click()
  await page.locator('#planner-output').waitFor()
  assert.equal(planningCalls, 1)
  assert.equal(imageCalls, 0)
  const downloadEvent = page.waitForEvent('download')
  await page.getByRole('button', { name: '下载整理记录与原文' }).click()
  const download = await downloadEvent
  assert.equal(download.suggestedFilename(), '文化墙需求整理.json')
  const apply = page.getByRole('button', { name: '已核对，填入上方需求（不会自动生成）', exact: true })
  await page.getByLabel('整理需求墙宽').fill('3600')
  assert.ok(await apply.isDisabled())
  await page.getByLabel('整理需求墙宽').fill('3500')
  await apply.click()
  assert.match(await page.locator('#prompt').inputValue(), /正视候选图/)
  assert.equal(await page.locator('#planner-copy').inputValue(), '专颜媄肤\nOur Prosime')
  assert.equal(imageCalls, 0)
  await page.route('**/api/planner/status', (route) => route.fulfill({ json: { available: false } }))
  await page.reload({ waitUntil: 'networkidle' })
  await page.locator('.planner-panel summary').click()
  assert.ok(await page.getByRole('button', { name: '整理需求与提示词', exact: true }).isDisabled())
  console.log('PASS: 授权门槛、模拟整理、原文保留、修改输入失效、人工应用、下载、未配置状态；无付费调用。')
} finally { await browser.close() }
