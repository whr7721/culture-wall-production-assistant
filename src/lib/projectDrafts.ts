import type { Project } from './projects'
const key = (owner: string, id: string) => `wall-draft:v1:${owner}:${id}`
export const draftStore = {
  read(owner: string, id: string): Project | null {
    try { const p = JSON.parse(localStorage.getItem(key(owner, id)) || 'null'); return p?.id === id && Array.isArray(p.elements) ? p : null } catch { return null }
  },
  write(owner: string, project: Project) { localStorage.setItem(key(owner, project.id), JSON.stringify(project)) },
  remove(owner: string, id: string) { localStorage.removeItem(key(owner, id)) },
}
