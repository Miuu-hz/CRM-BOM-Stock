import { Router, Request, Response } from 'express'

const router = Router()

router.get('/', async (req: Request, res: Response) => {
  res.json({ success: true, data: [] })
})

router.get('/:id', async (req: Request, res: Response) => {
  res.json({ success: true, data: null })
})

router.post('/', async (req: Request, res: Response) => {
  res.json({ success: true, message: 'Stock item created' })
})

router.post('/movement', async (req: Request, res: Response) => {
  res.json({ success: true, message: 'Stock movement recorded' })
})

router.put('/:id', async (req: Request, res: Response) => {
  res.json({ success: true, message: 'Stock item updated' })
})

router.delete('/:id', async (req: Request, res: Response) => {
  res.json({ success: true, message: 'Stock item deleted' })
})

export default router
