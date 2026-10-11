import type { ImageAspect } from '../shared/imageSize'

export type Aspect = ImageAspect
export type StylePreset = 'brand' | 'technology' | 'humanistic'
export type ImageModelChoice = 'default' | 'kami-banana' | 'kami-banana-4k'
export interface ImageModelOption { id: ImageModelChoice; label: string; available: boolean; detail: string }

export interface GenerationResult {
  id: string
  imageUrl: string
  prompt: string
  style: StylePreset
  aspect: Aspect
  requestedSize?: string
  task?: 'space' | 'flat'
  exactCopy?: string
  wallWidthMm?: number
  wallHeightMm?: number
  createdAt: string
  provider?: string
  model?: string
}

export interface ApiErrorBody {
  error?: string
}
