import { describe, expect, it } from 'vitest'
import { projectSchema, projectWarnings } from './project.ts'

const id = '11111111-1111-4111-8111-111111111111'
const now = new Date().toISOString()
const baseline = {
  id, title: '测试文化墙', widthMm: 3500, heightMm: 2300,
  measurementStatus: 'confirmed', copy: '准确文案', notes: '',
  obstacles: [{ id: '22222222-2222-4222-8222-222222222222', label: '门洞', x: 100, y: 500, width: 600, height: 1800 }],
  elements: [], assets: [], concepts: [], status: 'draft', revision: 1, createdAt: now, updatedAt: now,
}

describe('measured elevation', () => {
  it('keeps dimensions and blocks unmeasured approval', () => {
    const project = projectSchema.parse(baseline)
    expect(projectWarnings(project)).toEqual([])
    expect(projectWarnings({ ...project, measurementStatus: 'to_measure' })).toContain('墙体尺寸尚未复尺确认')
  })
  it('detects obstacles and out-of-bounds objects', () => {
    const project = projectSchema.parse({
      ...baseline,
      elements: [{ id: '33333333-3333-4333-8333-333333333333', kind: 'rect', x: 200, y: 600, width: 3400, height: 300, fill: '#123456' }],
    })
    expect(projectWarnings(project).some((text) => text.includes('冲突'))).toBe(true)
    expect(projectWarnings(project).some((text) => text.includes('超出墙体'))).toBe(true)
  })
})
