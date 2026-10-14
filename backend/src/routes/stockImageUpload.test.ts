import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import stockRouter from './stock.routes'
import { createTestUser } from '../test/testAuth'

const app = express()
app.use('/api/stock', stockRouter)

const uploadsRoot = path.join(__dirname, '..', '..', 'uploads')
const stockImagesDir = path.join(uploadsRoot, 'stock-images')

describe('POST /api/stock/:id/image (path traversal)', () => {
  it('ignores an encoded ../ in :id and leaves no file behind when the item is not found', async () => {
    const { token } = createTestUser()
    const marker = `escape-${randomUUID()}`
    const before = new Set(fs.readdirSync(stockImagesDir))

    const res = await request(app)
      .post(`/api/stock/..%2F${marker}/image`)
      .set('Authorization', `Bearer ${token}`)
      .attach('image', Buffer.from('not an image'), { filename: 'x.jpg', contentType: 'image/jpeg' })

    expect(res.status).toBe(404)
    // ไม่มีไฟล์หลุดออกไปนอก stock-images
    expect(fs.readdirSync(uploadsRoot).some(f => f.startsWith(marker))).toBe(false)
    // และไม่มีไฟล์ขยะค้างใน stock-images
    expect(fs.readdirSync(stockImagesDir).filter(f => !before.has(f))).toEqual([])
  })
})
