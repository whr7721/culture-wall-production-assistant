import { describe, expect, it } from 'vitest'
import { buildGenerationPrompt, sizeByAspect } from './generation.ts'

describe('buildGenerationPrompt', () => {
  it('keeps the customer request and adds the chosen visual direction', () => {
    const result = buildGenerationPrompt('设计一面科技企业文化墙', 'technology')
    expect(result).toContain('设计一面科技企业文化墙')
    expect(result).toContain('现代科技展陈风格')
    expect(result).toContain('不要添加水印')
  })

  it('falls back to brand style for an unknown value', () => {
    expect(buildGenerationPrompt('设计一面文化墙', 'unknown')).toContain('现代品牌展示风格')
  })
})

describe('size mapping', () => {
  it('uses provider-tested standard image sizes', () => {
    expect(sizeByAspect.landscape).toBe('1536x1024')
    expect(sizeByAspect.square).toBe('1024x1024')
    expect(sizeByAspect.portrait).toBe('1024x1536')
  })
})
