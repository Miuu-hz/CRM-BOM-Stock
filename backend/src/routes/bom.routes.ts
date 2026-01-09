import { Router, Request, Response } from 'express'

const router = Router()

router.get('/', async (req: Request, res: Response) => {
  res.json({ success: true, data: [] })
})

router.get('/:id', async (req: Request, res: Response) => {
  res.json({ success: true, data: null })
})

router.post('/', async (req: Request, res: Response) => {
  res.json({ success: true, message: 'BOM created' })
})

router.put('/:id', async (req: Request, res: Response) => {
  res.json({ success: true, message: 'BOM updated' })
})

router.delete('/:id', async (req: Request, res: Response) => {
  res.json({ success: true, message: 'BOM deleted' })
})

export default router
