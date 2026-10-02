export const stylePrompt: Record<string, string> = {
  brand: '现代品牌展示风格，克制留白，清晰的信息层级，材质真实，适合企业展厅落地',
  technology: '现代科技展陈风格，深色与金属质感，适度灯光层次，空间精致但不过度炫技',
  humanistic: '人文叙事展陈风格，稳重、有秩序，适合文化宣传与党建展示，避免模板化堆砌',
}

export const sizeByAspect: Record<string, string> = {
  landscape: '1536x1024',
  square: '1024x1024',
  portrait: '1024x1536',
}

export function buildGenerationPrompt(userPrompt: string, style: string): string {
  const direction = stylePrompt[style] || stylePrompt.brand
  return [
    '生成一张专业、真实、可用于客户方案沟通的文化墙或企业展示墙正面效果图。',
    `客户需求：${userPrompt.trim()}`,
    `视觉方向：${direction}。`,
    '若有参考图片：第一张优先理解为现场墙面或主构图参考，其余图片理解为 Logo、品牌素材或风格参考；保持墙体结构关系，不照搬参考图里的无关内容。',
    '画面要求：正面或轻微透视，完整展示墙面，尺度可信，材质与灯光自然，排版具有真实设计公司的完成度。',
    '文字要求：只把文案当作排版意向；不要编造大段难以辨认的小字，不要添加水印、价格、二维码或界面元素。',
  ].join('\n')
}
