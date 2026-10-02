export type Aspect = 'landscape' | 'square' | 'portrait'
export type StylePreset = 'brand' | 'technology' | 'humanistic'

export interface GenerationResult {
  id: string
  imageUrl: string
  prompt: string
  style: StylePreset
  aspect: Aspect
  createdAt: string
}

export interface ApiErrorBody {
  error?: string
}
