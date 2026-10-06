import dotenv from 'dotenv'
import path from 'path'

// Same loading convention as src/index.ts: read backend/.env regardless of cwd.
dotenv.config({ path: path.resolve(__dirname, '.env') })

// คอลัมน์ users.departments/custom_permissions และ purchase_orders.approved_at/rejection_reason
// เคยต้อง ALTER ในไฟล์นี้เพราะ DB ใหม่ไม่มี — ตอนนี้ migration "schema drift" ใน db/migrations.ts
// เพิ่มให้แล้ว จึงไม่ปะที่นี่อีก (ปะไว้จะบังกรณี migration หาย เหมือนที่เคยบังมาก่อน)
