import { Request, Response, NextFunction } from 'express'
import { ZodSchema, ZodTypeDef } from 'zod'

export const validate = <Output, Def extends ZodTypeDef = ZodTypeDef, Input = Output>(
  schema: ZodSchema<Output, Def, Input>
) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body)
    if (!result.success) {
      const message = result.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join(', ')
      res.status(400).json({ success: false, message })
      return
    }
    req.validated = result.data
    next()
  }
}
