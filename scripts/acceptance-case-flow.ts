import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { chromium } from 'playwright-core'
import type { Project, WallElement } from '../src/lib/projects'

// 测试夹具模拟设计师手工排版，不是AI自动分层或自动从透视图重建。
const dir = 'output/2026-10-11-flow'
const generation = JSON.parse(await readFile(`${dir}/generation.json`, 'utf8'))
const base = 'http://127.0.0.1:8787'
async function checked(response: Response) { const body = await response.json(); if (!response.ok) throw new Error(body.error); return body }
let project: Project = await checked(await fetch(`${base}/api/projects`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: `专颜媄肤-流程验收-未实测-${Date.now()}` }) }))
const form = new FormData()
form.set('asset', new Blob([await readFile(`${dir}/concept.png`)], { type: 'image/png' }), '空间概念-不可编辑文字.png')
project = (await checked(await fetch(`${base}/api/projects/${project.id}/assets`, { method: 'POST', body: form }))).project
const elements: WallElement[] = []
function text(value: string, x: number, y: number, width: number, height: number, fontSizeMm = 42) { elements.push({ id: randomUUID(), kind: 'text', text: value, x, y, width, height, fontSizeMm, color: '#143d68' }) }
function rect(x: number, y: number, width: number, height: number, label: string) { elements.push({ id: randomUUID(), kind: 'rect', x, y, width, height, label, fill: '#eef3f8' }) }
rect(100,100,780,420,'Logo占位（原件缺失）'); text('Logo 待提供原始素材',160,260,680,100,44)
text('专颜媄肤',1000,100,1800,230,150)
text('文化墙平面排版验收样例 · 尺寸未实测',1000,350,2300,100,40)
rect(100,650,780,1350,'品牌故事底板')
text('品牌故事',150,690,670,110,65)
text('专颜媄肤\n成立于2019年，\n以专业、安全、自然为核心理念，\n致力于为求美者提供科学定制化的\n高品质皮肤管理服务\n我们相信，真正的美\n源于对细节的坚持以及对\n每一位顾客的真诚关怀',150,850,670,1000,38)
text('塑美流程',1000,580,1700,100,64)
;['1咨询预约','2专业面诊','3制定方案','4安心调理','5术后关怀'].forEach((value,index)=>{ rect(1000+index*430,740,400,160,'流程'); text(value,1020+index*430,785,360,90,42) })
text('我们的承诺 Our Prosime',1000,990,1700,100,60)
const commitments = [
 '01 ONE\n皮肤检测\n精准量肤 有效评估','02 TWO\n辩证分型\n因人施方 科学搭配','03 THREE\n实时跟踪\n全程指导 效果见证','04 FOUR\n科学配方\n不含铅汞 激素\n抗生素 等',
 '05 FIVE\n倾心呵护\n长效保持 健康稳定','06 SIX 无添加\n无人工香精\n矿物油.荧光剂','07 SEVEN\n客服随访\n一对一跟效果\n随时答疑','08 EIGHT\n安全可靠\n国家食品药品\n监督局备案',
]
commitments.forEach((value,index)=>{ const x=1000+(index%4)*430,y=1160+Math.floor(index/4)*440;rect(x,y,400,390,'承诺底板');text(value,x+20,y+40,360,290,36) })
text('皮肤养护技巧',2800,1010,600,120,58)
text('定期补水\n\n合理饮食\n\n防晒保护\n\n正确护肤\n\n保证睡眠',2800,1200,570,850,42)
project = await checked(await fetch(`${base}/api/projects/${project.id}`, { method: 'PUT', headers:{'Content-Type':'application/json'},body:JSON.stringify({ ...project, widthMm:3500,heightMm:2300,measurementStatus:'to_measure',copy:generation.sourcePlan.source.exactCopy,notes:'流程验收夹具：排版由脚本模拟人工操作，并非AI分层。3500×2300来自需求对话，未实测。保留Logo缺失/桌高未知，不作为生产稿。',elements,concepts:[{id:generation.id,imageUrl:generation.imageUrl,provider:generation.provider,model:generation.model,role:'space',createdAt:generation.createdAt}] }) }))
const browser=await chromium.launch({executablePath:'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',headless:true})
try {
 const page=await browser.newPage({acceptDownloads:true})
 await page.goto('http://127.0.0.1:5173',{waitUntil:'networkidle'})
 await page.getByLabel('选择项目').selectOption(project.id)
 await page.waitForFunction((count)=>document.querySelectorAll('.element-picks button').length===count,elements.length)
 await page.getByLabel('墙宽 mm').waitFor()
 assert.equal(await page.getByLabel('墙宽 mm').inputValue(),'3500')
 await page.getByRole('button',{name:'保存项目',exact:true}).click()
 await page.getByText('已保存到服务器',{exact:false}).waitFor()
 await page.reload({waitUntil:'networkidle'})
 await page.getByLabel('选择项目').selectOption(project.id)
 await page.waitForFunction((count)=>document.querySelectorAll('.element-picks button').length===count,elements.length)
 assert.equal(await page.locator('.element-picks button').count(),elements.length)
 // 未实测项目必须被阻止确认。
 await page.getByRole('button',{name:'确认平面稿',exact:true}).click()
 await page.getByText('仍有尺寸或碰撞问题，不能确认平面稿',{exact:false}).waitFor()
 // 仅在测试上下文内导出副本；服务器项目保持to_measure/draft。
 await mkdir(dir,{recursive:true})
 for(const format of ['svg','png'] as const) {
  const downloaded=page.waitForEvent('download')
  await page.evaluate(async ({ candidate, format })=> {
   const exports=await import('/src/lib/exports.ts')
   const exportCopy={...candidate,status:'approved'}
   if(format==='svg') await exports.downloadSvg(exportCopy)
   else await exports.downloadPreview(exportCopy)
  },{candidate:project,format})
  await (await downloaded).saveAs(`${dir}/editable-test.${format}`)
 }
 const svg=await readFile(`${dir}/editable-test.svg`,'utf8')
 assert.ok(svg.includes('width="3500mm"')&&svg.includes('height="2300mm"'))
 assert.ok(svg.includes('viewBox="0 0 3500 2300"'))
 assert.ok(svg.includes('专颜媄肤')&&svg.includes('Our Prosime'))
 assert.equal((svg.match(/<text /g)||[]).length,elements.filter(e=>e.kind==='text').length)
 assert.equal((await readFile(`${dir}/editable-test.png`)).subarray(0,8).toString('hex'),'89504e470d0a1a0a')
 const persisted=await checked(await fetch(`${base}/api/projects/${project.id}`))
 assert.equal(persisted.measurementStatus,'to_measure');assert.equal(persisted.status,'draft')
 await page.screenshot({path:`${dir}/workspace.png`,fullPage:true})
 console.log(JSON.stringify({passed:true,projectId:project.id,title:project.title,independentTextObjects:elements.filter(e=>e.kind==='text').length,savedReopened:true,unmeasuredApprovalBlocked:true,exportsAreTestCopies:true,files:[`${dir}/editable-test.svg`,`${dir}/editable-test.png`]}))
} finally {await browser.close()}
