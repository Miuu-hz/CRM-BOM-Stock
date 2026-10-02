import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import searchRouter from './search.routes'
import { createTestUser } from '../test/testAuth'

const app = express()
app.use(express.json())
app.use('/api/search', searchRouter)

// Phase 2: พิมพ์เลขเอกสารแล้วเปิดสายเอกสารได้ — เดิมค้น GR/PR/ใบแจ้งหนี้ซื้อ/ใบเสร็จ/บิล POS ไม่เจอเลย
describe('GET /search — กลุ่มเอกสาร', () => {
  it('ค้นเลขใบขอซื้อ เจอในกลุ่ม documents พร้อม docKind และไม่รั่วข้ามบริษัท', async () => {
    const a = createTestUser({ role: 'ADMIN' })
    const b = createTestUser({ role: 'ADMIN' })
    const grId = generateId()
    db.prepare(`INSERT INTO purchase_requests (id, tenant_id, pr_number, requester_id, requester_name, status)
                VALUES (?, ?, 'PR-ZZ9-280926', ?, 'ทดสอบ', 'DRAFT')`).run(grId, a.tenantId, a.userId)

    const res = await request(app).get('/api/search').query({ q: 'pr-zz9' }).set('Authorization', `Bearer ${a.token}`)
    expect(res.status).toBe(200)
    const hit = res.body.data.documents.find((d: any) => d.id === grId)
    expect(hit).toMatchObject({ type: 'document', docKind: 'PURCHASE_REQUEST', label: 'PR-ZZ9-280926' })

    const other = await request(app).get('/api/search').query({ q: 'pr-zz9' }).set('Authorization', `Bearer ${b.token}`)
    expect(other.body.data.documents).toEqual([])
  })

  it('คำค้นสั้นเกินได้ documents ว่าง', async () => {
    const a = createTestUser({ role: 'ADMIN' })
    const res = await request(app).get('/api/search').query({ q: 'g' }).set('Authorization', `Bearer ${a.token}`)
    expect(res.body.data.documents).toEqual([])
  })
})
