import type { GenerationResult } from '../types'

const STORAGE_KEY = 'culture-wall-generation-history-v1'
const LIMIT = 8

export function loadHistory(): GenerationResult[] {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return value ? (JSON.parse(value) as GenerationResult[]) : []
  } catch {
    return []
  }
}

export function saveHistory(items: GenerationResult[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, LIMIT)))
}
