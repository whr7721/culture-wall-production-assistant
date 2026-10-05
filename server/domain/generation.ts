import { standardImageSizes } from '../../shared/imageSize.ts'

export const stylePrompt: Record<string, string> = {
  brand: '现代品牌展示风格，克制留白，清晰的信息层级，材质真实，适合企业展厅落地',
  technology: '现代科技展陈风格，深色与金属质感，适度灯光层次，空间精致但不过度炫技',
  humanistic: '人文叙事展陈风格，稳重、有秩序，适合文化宣传与党建展示，避免模板化堆砌',
}

export const sizeByAspect: Record<string, string> = standardImageSizes

export function buildGenerationPrompt(userPrompt: string, style: string, shortTitle = ''): string {
  const direction = stylePrompt[style] || stylePrompt.brand
  const title = shortTitle.trim()
  const textInstruction = title
    ? `画面中仅允许出现一次这句短标题：“${title}”。使用足够大的清晰简体中文无衬线字、高对比、留足空间；除此之外不要生成任何小字、假字、英文、水印或文字纹理。如果无法准确呈现，宁可留白，不要画似字非字的笔画。客户需求中的其他文案只用于理解内容，不要直接绘制。`
    : '画面中不生成任何可见文字、假字、数字或水印；预留干净的标题和正文区域，准确文字将在后续可编辑平面稿中添加。客户需求中的文案只用于理解内容，不要直接绘制。参考图中的 Logo 仅作位置和风格参考，不要重新拼写或改写其文字。'
  return [
    '生成一张专业、真实、可用于客户方案沟通的文化墙或企业展示墙正面效果图。',
    `客户需求：${userPrompt.trim()}`,
    `视觉方向：${direction}。`,
    '若有参考图片：第一张优先理解为现场墙面或主构图参考，其余图片理解为 Logo、品牌素材或风格参考；保持墙体结构关系，不照搬参考图里的无关内容。',
    '画面要求：正面或轻微透视，完整展示墙面，尺度可信，材质与灯光自然，排版具有真实设计公司的完成度。',
    `文字要求：${textInstruction} 不要添加价格、二维码或界面元素。`,
  ].join('\n')
}
