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
  await page.route('**/api/generations', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: '3aea2f86-51e7-45ca-accc-4ddb8b613ab4',
        imageUrl: '/generated/3aea2f86-51e7-45ca-accc-4ddb8b613ab4.png',
        prompt: '受邀测试浏览器流程',
        style: 'technology',
        aspect: 'landscape',
        createdAt: new Date().toISOString(),
      }),
    })
  })

  await page.goto(baseUrl, { waitUntil: 'networkidle' })
  await page.locator('textarea').fill('为科技企业设计一面蓝白色文化墙，左侧品牌故事，右侧核心价值观。')
  await page.getByRole('button', { name: '生成文化墙提案' }).click()
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
  console.log('浏览器验收通过：提交→展示→下载→历史跨刷新→结果作为参考。生成响应采用现有服务器图片夹具，未额外调用生图 API。')
} finally {
  await browser.close()
}
