import { describe, expect, it } from 'vitest'
import { buildGenerationPrompt, sizeByAspect } from './generation.ts'
import { resolveImageSize } from '../../shared/imageSize.ts'

describe('buildGenerationPrompt', () => {
  it('keeps the customer request and adds the chosen visual direction', () => {
    const result = buildGenerationPrompt('设计一面科技企业文化墙', 'technology')
    expect(result).toContain('设计一面科技企业文化墙')
    expect(result).toContain('现代科技展陈风格')
    expect(result).toContain('不生成任何可见文字')
  })

  it('falls back to brand style for an unknown value', () => {
    expect(buildGenerationPrompt('设计一面文化墙', 'unknown')).toContain('现代品牌展示风格')
  })

  it('limits image lettering to one explicit short title', () => {
    const result = buildGenerationPrompt('展现企业文化，正文有很多字', 'brand', '创新引领未来')
    expect(result).toContain('仅允许出现一次这句短标题：“创新引领未来”')
    expect(result).toContain('其他文案只用于理解内容，不要直接绘制')
  })
})

describe('size mapping', () => {
  it('uses provider-tested standard image sizes', () => {
    expect(sizeByAspect.landscape).toBe('1536x1024')
    expect(sizeByAspect.square).toBe('1024x1024')
    expect(sizeByAspect.portrait).toBe('1024x1536')
  })

  it('checks custom pixels before accepting a potentially billable task', () => {
    expect(resolveImageSize('custom', '1600x1024')).toBe('1600x1024')
    expect(resolveImageSize('custom', '1599x1024')).toBeNull()
    expect(resolveImageSize('custom', '2048x512')).toBeNull()
    expect(resolveImageSize('custom', '512x512')).toBeNull()
    expect(resolveImageSize('unknown')).toBeNull()
  })
})
