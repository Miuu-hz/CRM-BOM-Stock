# Phopy ERP — Agent & Development Rules

---

## 🛑 กฎเหล็กการทำงาน (Strict Rules for AI Agents & Developers)

### 1. 🚫 ห้ามวางไฟล์ใดๆ ใน /root เด็ดขาด (Strict No-Junk in /root)
- **เด็ดขาด:** **ห้าม** นำไฟล์ .bak, ไฟล์สำรอง, ไฟล์ patch, โฟลเดอร์ workspace ย่อย (เช่น crm-*-fix), หรือสคริปต์ใดๆ ไปวางไว้ใน /root โดยสิ้นเชิง!
- โฟลเดอร์ /root มีไว้สำหรับ config ของระบบเท่านั้น (เช่น .ssh, .bashrc)
- หากจำเป็นต้องมีไฟล์ชั่วคราว, ไฟล์สำรองฉุกเฉิน, diff patch หรือทดลอง ให้วางไว้ที่:
  /scratch/  (หรือ /opt/scratch/)

### 2. 📝 กฎกระดาษทด (Scratchpad Rule) — ใช้ /scratch/ เท่านั้น
- **ห้าม** สร้างไฟล์สคริปต์ทดสอบ / กระดาษทด (เช่น 	mp_*.js, check_*.js, seed_*.js, 	est_*.js, 	mp_*.ts, *.sql) ไว้ใน /opt/crm/ หรือ /opt/crm/backend/ โดยเด็ดขาด
- **ให้ใช้โฟลเดอร์นี้เท่านั้น:**
  /scratch/  (หรือ /opt/scratch/)
- เมื่อทดสอบเสร็จแล้วให้ลบทิ้งทันที ห้ามปล่อยค้างทิ้งไว้

### 3. 🛡️ กฎการ Backup โค้ด (Code Backup Rule) — ห้ามสร้างไฟล์ .bak
- **ห้าม** ก๊อปปี้ไฟล์โค้ดเป็น .bak, *.tsx.bak, *.ts.bak, *.bak-* ในโฟลเดอร์ใดๆ เด็ดขาด
- โค้ดทั้งหมดอยู่ภายใต้ **Git Version Control** อยู่แล้ว หากต้องการกันเหนียวก่อนแก้ไข ให้ใช้:
  - git stash เพื่อเก็บงานชั่วคราว
  - git branch <feature-name> เพื่อแตกกิ่งทดลอง
  - หรือ export patch ไปไว้ที่ /scratch/patch_name.diff

### 4. 🗄️ กฎการ Backup ฐานข้อมูล (Database Retention: Max 3)
- **ห้าม** วางไฟล์สำรองฐานข้อมูล (dev.db.bak-*, *.sqlite.bak) ไว้ที่ root ของ backend หรือใน /root เด็ดขาด
- **จุดเก็บเดียวที่อนุญาต:**
  /opt/crm/backend/backups/
- **Retention Policy (Max 3 Revisions):**
  - อนุญาตให้เก็บสำรองย้อนหลัง **สูงสุดไม่เกิน 3 ไฟล์ล่าสุด** ต่อประเภทเท่านั้น
  - หากสร้าง snapshot ใหม่ ต้องลบตัวเก่าที่สุดทิ้งทันที ห้ามสะสมเกิน 3 ไฟล์

---
