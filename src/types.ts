import type { ImageAspect } from '../shared/imageSize'

export type Aspect = ImageAspect
export type StylePreset = 'brand' | 'technology' | 'humanistic'

export interface GenerationResult {
  id: string
  imageUrl: string
  prompt: string
  style: StylePreset
  aspect: Aspect
  requestedSize?: string
  createdAt: string
  provider?: string
  model?: string
}

export interface ApiErrorBody {
  error?: string
}
