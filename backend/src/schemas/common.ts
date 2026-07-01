import { z } from 'zod'

export const idSchema = z
  .string()
  .regex(/^[0-9a-fA-F]{24,32}$/, { message: 'Invalid id format' })

export const tenantIdSchema = z.string().min(1, { message: 'tenantId is required' })

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
})
