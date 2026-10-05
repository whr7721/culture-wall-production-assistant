import type { ApiErrorBody, Aspect, GenerationResult, StylePreset } from '../types'

interface GenerateInput {
  prompt: string
  style: StylePreset
  aspect: Aspect
  references: File[]
  size?: string
  shortTitle?: string
}

export async function generateImage(input: GenerateInput): Promise<GenerationResult> {
  const form = new FormData()
  form.set('prompt', input.prompt)
  form.set('style', input.style)
  form.set('aspect', input.aspect)
  if (input.size) form.set('size', input.size)
  if (input.shortTitle) form.set('shortTitle', input.shortTitle)
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
