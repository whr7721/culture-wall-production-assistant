import type { ApiErrorBody, Aspect, GenerationResult, ImageModelChoice, ImageModelOption, StylePreset } from '../types'

interface GenerateInput {
  prompt: string
  style: StylePreset
  aspect: Aspect
  references: File[]
  size?: string
  shortTitle?: string
  modelChoice?: ImageModelChoice
  task?: 'space' | 'flat'
  exactCopy?: string
  wallWidthMm?: number
  wallHeightMm?: number
}

export async function getImageModels(): Promise<ImageModelOption[]> {
  const response = await fetch('/api/generations/models')
  if (!response.ok) throw new Error('生图模型列表加载失败')
  const payload = await response.json() as { models: ImageModelOption[] }
  return payload.models
}

export async function generateImage(input: GenerateInput): Promise<GenerationResult> {
  const form = new FormData()
  form.set('prompt', input.prompt)
  form.set('style', input.style)
  form.set('aspect', input.aspect)
  if (input.task) form.set('task', input.task)
  if (input.exactCopy) form.set('exactCopy', input.exactCopy)
  if (input.wallWidthMm) form.set('wallWidthMm', String(input.wallWidthMm))
  if (input.wallHeightMm) form.set('wallHeightMm', String(input.wallHeightMm))
  if (input.size) form.set('size', input.size)
  if (input.shortTitle) form.set('shortTitle', input.shortTitle)
  if (input.modelChoice) form.set('modelChoice', input.modelChoice)
  input.references.forEach((file) => form.append('references', file))

  const response = await fetch('/api/generations', {
    method: 'POST',
    body: form,
  })

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ApiErrorBody
    throw new Error(body.error || `生成失败（HTTP ${response.status}）`)
  }

  return response.json() as Promise<GenerationResult>
}
