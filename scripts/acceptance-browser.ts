import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright-core'

const browserPath = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const baseUrl = process.env.TRIAL_URL || 'http://127.0.0.1:18080'
const credentialsText = await readFile(path.resolve('data/invite-credentials/owner.txt'), 'utf8')
const credentials = Object.fromEntries(credentialsText.trim().split(/\r?\n/).map((line) => line.split('=', 2)))
const browser = await chromium.launch({ executablePath: browserPath, headless: true })

try {
  const context = await browser.newContext({
    httpCredentials: { username: credentials.username, password: credentials.password },
    acceptDownloads: true,
  })
  const page = await context.newPage()
  let submittedBody = ''
  let mockImageUrl = ''
  await page.route('**/api/generations', async (route) => {
    submittedBody = route.request().postData() || ''
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: '3aea2f86-51e7-45ca-accc-4ddb8b613ab4',
        imageUrl: mockImageUrl,
        prompt: '受邀测试浏览器流程',
        style: 'technology',
        aspect: 'landscape',
        createdAt: new Date().toISOString(),
      }),
    })
  })

  await page.goto(baseUrl, { waitUntil: 'networkidle' })
  await page.locator('#image-model option').first().waitFor({ state: 'attached' })
  if (await page.locator('#image-model option').count() !== 3) throw new Error('生图模型下拉菜单缺少选项')
  if (process.env.EXPECT_BANANA_MODELS === '1') {
    for (const model of ['kami-banana', 'kami-banana-4k']) {
      await page.locator('#image-model').selectOption(model)
      if (await page.locator('#image-model').inputValue() !== model) throw new Error(`${model} 无法选中`)
    }
    await page.locator('#image-model').selectOption('default')
  }
  await page.locator('textarea').fill('为科技企业设计一面蓝白色文化墙，左侧品牌故事，右侧核心价值观。')
  await page.locator('#short-title').fill('创新引领未来')
  const imageData = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 8; canvas.height = 8
    const context = canvas.getContext('2d')!
    context.fillStyle = '#315d7b'
    context.fillRect(0, 0, 8, 8)
    return canvas.toDataURL('image/png').split(',')[1]
  })
  mockImageUrl = `data:image/png;base64,${imageData}`
  await page.locator('input[type=file]').first().setInputFiles({ name: 'test-wall.png', mimeType: 'image/png', buffer: Buffer.from(imageData, 'base64') })
  await page.locator('img[alt="test-wall.png 缩略图"]').waitFor()
  await page.getByRole('button', { name: /自定义/ }).click()
  await page.getByLabel('自定义宽度').fill('1599')
  if (!(await page.getByRole('button', { name: '生成文化墙提案' }).isDisabled())) throw new Error('无效自定义尺寸未阻止提交')
  await page.getByLabel('自定义宽度').fill('1600')
  await page.getByLabel('自定义高度').fill('1024')
  await page.getByRole('button', { name: '生成文化墙提案' }).click()
  if (!submittedBody.includes('name="size"') || !submittedBody.includes('1600x1024') || !submittedBody.includes('创新引领未来') || !submittedBody.includes('name="modelChoice"')) throw new Error('自定义尺寸、短标题或模型选项没有发送到本站 API')
  await page.locator('img[alt="生成的文化墙效果图"]').waitFor()
  const downloadEvent = page.waitForEvent('download')
  await page.getByRole('link', { name: '下载图片' }).click()
  const download = await downloadEvent
  if (!download.suggestedFilename().endsWith('.png')) throw new Error('下载文件名异常')
  await page.getByText('最近方案').waitFor()
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByText('最近方案').waitFor()
  await page.locator('.history-grid button').first().click()
  await page.getByRole('button', { name: '作为参考继续修改' }).click()
  await page.getByText('墙面/主参考').waitFor()
  console.log(`浏览器验收通过：${process.env.EXPECT_BANANA_MODELS === '1' ? '两款 Banana 模型可切换、' : ''}短标题、自定义尺寸、上传缩略图→提交→展示→下载→历史跨刷新→继续修改。生成响应采用模拟图片，未调用生图 API。`)
} finally {
  await browser.close()
}
