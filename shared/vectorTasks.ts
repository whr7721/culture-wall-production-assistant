export type VectorTaskContext = { projectId: string; assetId: string; elementId: string; crop: { x: number; y: number; width: number; height: number } }
export type VectorTaskStatus = 'running' | 'processing' | 'ready' | 'needs_repair' | 'upstream_failed' | 'unknown'
export type VectorTaskOptions = { 'output.draw_style': 'fill_shapes' | 'stroke_shapes' | 'stroke_edges'; 'processing.palette': string; 'processing.max_colors': number; 'output.group_by': 'none' | 'color' | 'parent' | 'layer' }
export type VectorTaskView = {
  id: string; status: VectorTaskStatus; createdAt: string; updatedAt: string; legacy?: boolean
  provider: 'vectorizerai'; channel: string; mode: string; cached?: boolean
  estimatedCost: number | null; budgetUnit: 'PTC' | 'credit'; actualCostKnown: false
  upstreamStatus?: number; upstreamRequestId?: string; chargedCredits?: string | null
  rawBytes?: number; rawComplete?: boolean; rawUrl?: string; url?: string; previewUrl?: string
  width?: number; height?: number; pathCount?: number; svg?: string; editable?: boolean
  warnings?: string[]; error?: string; errorStatus?: number; context?: VectorTaskContext
  options?: VectorTaskOptions; input?: { width: number; height: number; bytes: number }
}
