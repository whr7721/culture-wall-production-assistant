import { z } from 'zod'

export const plannerInputSchema = z.object({
  brief: z.string().trim().min(10).max(1200).transform((text) => text.replace(/\r\n/g, '\n')),
  exactCopy: z.string().max(6000).transform((text) => text.replace(/\r\n/g, '\n')),
  widthMm: z.number().positive().max(100000),
  heightMm: z.number().positive().max(100000),
})
export type PlannerInput = z.infer<typeof plannerInputSchema>

export const plannerSuggestionSchema = z.object({
  summary: z.string().min(1).max(1500),
  zones: z.array(z.object({ title: z.string().max(100), content: z.string().max(1500) })).max(12),
  questions: z.array(z.string().max(500)).max(12),
  warnings: z.array(z.string().max(500)).max(12),
  imagePrompt: z.string().trim().min(10).max(1200),
})
export type PlannerResult = z.infer<typeof plannerSuggestionSchema> & {
  source: PlannerInput
  model: string
  instructionVersion: string
}
