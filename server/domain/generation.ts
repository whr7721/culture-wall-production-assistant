import { standardImageSizes } from '../../shared/imageSize.ts'

export const stylePrompt: Record<string, string> = {
  brand: '现代品牌展示风格，克制留白，清晰的信息层级，材质真实，适合企业展厅落地',
  technology: '现代科技展陈风格，深色与金属质感，适度灯光层次，空间精致但不过度炫技',
  humanistic: '人文叙事展陈风格，稳重、有秩序，适合文化宣传与党建展示，避免模板化堆砌',
}

export const sizeByAspect: Record<string, string> = standardImageSizes

export function buildGenerationPrompt(userPrompt: string, style: string, shortTitle = '', task = 'space', exactCopy = ''): string {
  const direction = stylePrompt[style] || stylePrompt.brand
  const title = shortTitle.trim()
  const textInstruction = '图形和全部客户文案一起生成。逐字保留汉字、英文、数字、标点和公司名称，不擅自纠错、概括或省略；正文使用清晰、可读的字体和足够空间，允许换行，不使用模糊横条或似字非字的纹理代替文字。不额外编造宣传语。'
  if (task === 'flat') return [
    '精确参考图编辑任务：将第一张空间效果图重绘为二维正视平面候选图，不重新设计。',
    '保留全部图形、圆形配图内容、Logo、装饰曲线、相对布局、颜色和文字；仅去除透视、房间环境、厚度、灯光与投影。不把复杂图案简化为图标，不省略元素。',
    '现场设备不是设计内容，以相同相对位置和大小的浅灰占位框保留全部设备、控制器和插座；不得移动、漏掉或在占位区画文字。被遮挡的细节不要臆造。',
    `客户补充要求：${userPrompt.trim()}`,
    exactCopy ? `准确文案原件（优先于图片中的错字，完整保留）：\n${exactCopy}` : '未提供文案原件时，保留参考图可见文字，不补造无法辨认的内容。',
    textInstruction,
    '输出仅包含墙面设计矩形。这是正视视觉候选位图，不是毫米级施工图或可编辑 SVG。',
  ].join('\n')
  return [
    '生成一张专业、真实、可用于客户方案沟通的文化墙或企业展示墙正面效果图。',
    `客户需求：${userPrompt.trim()}`,
    exactCopy ? `准确文案原件（完整呈现）：\n${exactCopy}` : '',
    title ? `重点标题：${title}（不限制其他客户文案出现）。` : '',
    `视觉方向：${direction}。`,
    '若有参考图片：第一张优先理解为现场墙面或主构图参考，其余图片理解为 Logo、品牌素材或风格参考；保留所有设备、控制器、插座、门和缺口的位置与大小，不遮挡，不移动，不漏掉；去除手写测量标线而非设备。原始Logo优先保持，不臆造未提供的Logo。',
    '画面要求：正面或轻微透视，完整展示墙面，尺度可信，材质与灯光自然，排版具有真实设计公司的完成度。',
    `文字要求：${textInstruction} 不要添加价格、二维码或界面元素。`,
  ].join('\n')
}
