import { describe, expect, it } from 'vitest'
import { buildGenerationPrompt, sizeByAspect } from './generation.ts'
import { resolveImageSize, imageSizeForWall } from '../../shared/imageSize.ts'

describe('buildGenerationPrompt', () => {
  it('keeps the customer request and adds the chosen visual direction', () => {
    const result = buildGenerationPrompt('设计一面科技企业文化墙', 'technology')
    expect(result).toContain('设计一面科技企业文化墙')
    expect(result).toContain('现代科技展陈风格')
    expect(result).toContain('图形和全部客户文案一起生成')
    expect(result).not.toContain('不要直接绘制')
  })

  it('falls back to brand style for an unknown value', () => {
    expect(buildGenerationPrompt('设计一面文化墙', 'unknown')).toContain('现代品牌展示风格')
  })

  it('keeps a title without suppressing other copy', () => {
    const result = buildGenerationPrompt('展现企业文化，正文有很多字', 'brand', '创新引领未来')
    expect(result).toContain('重点标题：创新引领未来')
    expect(result).toContain('不限制其他客户文案')
  })

  it('preserves full verbatim copy and uses an orthographic edit rather than a redesign', () => {
    const copy = 'ACH——上海汽连网络科技有限公司\n2018年：Duns认证'
    const result = buildGenerationPrompt('宽4766mm，高2690mm', 'brand', '', 'flat', copy)
    expect(result).toContain(copy)
    expect(result).toContain('不重新设计')
    expect(result).toContain('控制器和插座')
    expect(result).not.toContain('材质与灯光自然')
  })
})

describe('size mapping', () => {
  it('maps physical dimensions to a legal raster size without treating mm as pixels', () => {
    const size = imageSizeForWall(4766, 2690)!
    expect(resolveImageSize('custom', size)).toBe(size)
    const [width, height] = size.split('x').map(Number)
    expect(Math.abs(width / height / (4766 / 2690) - 1)).toBeLessThan(0.005)
    expect(imageSizeForWall(2690, 4766)).toBe(`${height}x${width}`)
    expect(imageSizeForWall(0, 2690)).toBeNull()
    expect(imageSizeForWall(10000, 1000)).toBeNull()
  })
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
