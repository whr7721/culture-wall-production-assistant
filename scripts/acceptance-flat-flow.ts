import { chromium } from 'playwright-core'
import { strict as assert } from 'node:assert'

// Only mocked image responses: validates wiring without spending the user's API budget.
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
try {
  const page = await browser.newPage()
  const bodies: string[] = []
  const copy = 'ACH——上海汽连网络科技有限公司\n欧连——上海欧连电子科技有限公司\n2018年：Duns认证'
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5xoAAAAASUVORK5CYII='
  await page.route('**/api/generations/models', (route) => route.fulfill({ json: { models: [{ id: 'default', label: '测试模型', available: true, detail: '模拟' }] } }))
  await page.route('**/api/generations', (route) => {
    bodies.push(route.request().postData() || '')
    return route.fulfill({ json: { id: `3aea2f86-51e7-45ca-accc-4ddb8b613ab${bodies.length}`, prompt: '实测尺寸宽4766mm高2690mm，蓝白色企业发展历程', exactCopy: copy, wallWidthMm: 4766, wallHeightMm: 2690, task: bodies.length === 1 ? 'space' : 'flat', imageUrl: `/generated/3aea2f86-51e7-45ca-accc-4ddb8b613ab${bodies.length}.png`, style: 'brand', aspect: 'landscape', createdAt: new Date().toISOString() } })
  })
  await page.route('**/generated/3aea2f86-51e7-45ca-accc-4ddb8b613ab*.png', (route) => route.fulfill({ contentType: 'image/png', body: Buffer.from(png, 'base64') }))
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' })
  assert.equal(await page.locator('.aspect-card').count(), 0)
  await page.getByRole('textbox', { name: '墙面宽度', exact: true }).count().catch(() => 0)
  await page.getByRole('spinbutton', { name: '墙面宽度', exact: true }).fill('4766')
  await page.getByRole('spinbutton', { name: '墙面高度', exact: true }).fill('2690')
  await page.locator('#prompt').fill('实测尺寸宽4766mm高2690mm，蓝白色企业发展历程')
  await page.locator('#exact-copy').fill(copy)
  await page.getByRole('button', { name: '生成文化墙提案' }).click()
  await page.getByRole('button', { name: '准备转二维正视图' }).waitFor()
  assert.ok(bodies[0].includes(copy.replace(/\n/g, '\r\n')) || bodies[0].includes(copy))
  await page.getByRole('button', { name: '准备转二维正视图' }).click()
  await page.waitForFunction(() => (document.querySelector('#generation-task') as HTMLSelectElement)?.value === 'flat')
  assert.equal(bodies.length, 1, 'Preparing a conversion must not make a paid request')
  assert.equal(await page.locator('#exact-copy').inputValue(), copy)
  await page.getByRole('button', { name: '生成二维正视候选' }).click()
  await page.waitForFunction(() => document.querySelector('.status.ready') !== null)
  assert.equal(bodies.length, 2)
  assert.ok(bodies[1].includes('name="task"\r\n\r\nflat'))
  assert.ok(bodies[1].includes('name="references"; filename="source-3aea2f86-51e7-45ca-accc-4ddb8b613ab1.png"'))
  await page.getByRole('button', { name: '进入工作台', exact: true }).click()
  await page.getByText('已带入图片、尺寸和文案并保存为新项目', { exact: false }).waitFor()
  assert.equal(bodies.length, 2, 'Entering workspace must not generate again')
  assert.equal(await page.getByLabel('墙宽 mm', { exact: true }).inputValue(), '4766')
  assert.equal(await page.getByLabel('墙高 mm', { exact: true }).inputValue(), '2690')
  assert.equal(await page.locator('.project-controls textarea').first().inputValue(), copy)
  assert.equal(await page.getByRole('button', { name: '生成空间概念', exact: true }).count(), 0)
  const projectId = await page.getByLabel('选择项目', { exact: true }).inputValue()
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByLabel('选择项目', { exact: true }).selectOption(projectId)
  await page.waitForFunction(() => (document.querySelector('.project-controls input[type=number]') as HTMLInputElement)?.value === '4766')
  assert.equal(await page.locator('.element-picks button').count(), 1)
  console.log('PASS: workspace handoff saves/reopens original dimensions, copy and one explicitly unlayered image; no extra generation')
  console.log('PASS: full copy → space result → prepare without billing → flat request with source reference and unchanged copy')
} finally { await browser.close() }
