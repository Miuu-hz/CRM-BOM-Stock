import { Router, Request, Response } from 'express'
import { globalSearch } from '../repositories/search.repository'

const router = Router()

router.get('/', (req: Request, res: Response) => {
  try {
    const query = (req.query.q as string || '').trim()

    if (query.length < 2) {
      return res.json({ success: true, data: { query, results: [], total: 0 } })
    }

    const data = globalSearch(query)
    res.json({ success: true, data })
  } catch (error) {
    console.error('Search error:', error)
    res.status(500).json({ success: false, message: 'Search failed' })
  }
})

export default router
