export type Obstacle = { id: string; label: string; x: number; y: number; width: number; height: number }
type Base = { id: string; x: number; y: number; width: number; height: number }
export type WallElement =
  | (Base & { kind: 'path'; d: string; sourceX: number; sourceY: number; sourceWidth: number; sourceHeight: number; fill: string; stroke: string; strokeWidth: number; fillRule?: 'nonzero' | 'evenodd'; strokeLineCap?: 'butt' | 'round' | 'square'; strokeLineJoin?: 'miter' | 'round' | 'bevel'; label: string })
  | (Base & { kind: 'rect'; fill: string; label: string })
  | (Base & { kind: 'text'; text: string; fontSizeMm: number; color: string; rotationDeg?: number; fontWeight?: number; ocrScore?: number; ocrPolygon?: [number, number][] })
  | (Base & { kind: 'image'; assetId: string; label: string })
export type Project = {
  id: string; title: string; widthMm: number; heightMm: number
  measurementStatus: 'confirmed' | 'to_measure'; copy: string; notes: string
  obstacles: Obstacle[]; elements: WallElement[]
  assets: { id: string; name: string; mime: string; url: string }[]
  concepts: { id: string; imageUrl: string; provider: string; model: string; role: 'space' | 'flat'; createdAt: string }[]
  status: 'draft' | 'approved'; revision: number; createdAt: string; updatedAt: string; warnings?: string[]
}
export type ProjectRow = Pick<Project, 'id' | 'title' | 'status' | 'updatedAt'>

async function checked<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || `请求失败：HTTP ${response.status}`)
  return data as T
}
export const listProjects = () => fetch('/api/projects').then(checked<ProjectRow[]>)
export const createProject = (title: string) => fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) }).then(checked<Project>)
export const getProject = (id: string) => fetch(`/api/projects/${id}`).then(checked<Project>)
export const saveProject = (project: Project) => fetch(`/api/projects/${project.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(project) }).then(checked<Project>)
export const uploadAsset = (project: Project, file: File) => {
  const form = new FormData()
  form.set('asset', file)
  return fetch(`/api/projects/${project.id}/assets`, { method: 'POST', body: form }).then(checked<{ project: Project }>)
}
