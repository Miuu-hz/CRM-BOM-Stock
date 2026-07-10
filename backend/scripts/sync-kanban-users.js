#!/usr/bin/env node
/**
 * Sync Mini-ERP users → Phopy Kanban (Planka)
 * - อ่าน users จาก SQLite (LXC 100) → upsert เข้า user_account บน Postgres (LXC 103)
 * - ใช้ bcrypt hash เดิม → user ล็อกอิน Kanban ด้วยอีเมล+รหัสผ่านเดียวกับ ERP
 * - รันโดย cron ทุก 10 นาที หรือรันมือ: node scripts/sync-kanban-users.js
 */
const path = require('path')
const Database = require(path.join(__dirname, '..', 'node_modules', 'better-sqlite3'))
const { Client } = require(path.join(__dirname, '..', 'node_modules', 'pg'))

const SQLITE_PATH = path.join(__dirname, '..', 'dev.db')
const PG_URL = 'postgresql://planka:7IKeu%2BlAcHaeDyoktJiEDvILLdryTd%2FpO%2BK%2BwiCPMo7G3tGBfZWwj4bR8V05dEkM@192.168.1.95:5432/planka'

async function main() {
  const sqlite = new Database(SQLITE_PATH, { readonly: true })
  const users = sqlite.prepare(`
    SELECT email, password, name, role, status
    FROM users
    WHERE status = 'active' AND email IS NOT NULL AND password IS NOT NULL
  `).all()
  sqlite.close()

  const pg = new Client({ connectionString: PG_URL })
  await pg.connect()

  // terms signature ปัจจุบัน (hash ของข้อตกลงเวอร์ชันล่าสุด) — ใส่ให้ user ใหม่เลย ข้ามหน้ายอมรับ
  const termsRow = await pg.query('SELECT terms_signature FROM user_account WHERE terms_signature IS NOT NULL LIMIT 1')
  const termsSig = termsRow.rows[0] ? termsRow.rows[0].terms_signature : null

  let created = 0, updated = 0, skipped = 0
  for (const u of users) {
    const email = String(u.email).toLowerCase().trim()
    // ERP MASTER/ADMIN → Planka admin, ที่เหลือ boardUser
    const plankaRole = ['MASTER', 'ADMIN'].includes(u.role) ? 'admin' : 'boardUser'
    try {
      const existing = await pg.query('SELECT id, password FROM user_account WHERE email = $1', [email])
      if (existing.rows.length === 0) {
        await pg.query(`
          INSERT INTO user_account (
            email, password, role, name,
            subscribe_to_own_cards, subscribe_to_card_when_commenting,
            turn_off_recent_card_highlighting, enable_favorites_by_default,
            default_editor_mode, default_home_view, default_projects_order,
            is_sso_user, is_deactivated, language,
            created_at, password_changed_at,
            terms_signature, terms_accepted_at
          ) VALUES (
            $1, $2, $3, $4,
            false, true, false, false,
            'wysiwyg', 'groupedProjects', 'byDefault',
            false, false, 'en-GB',
            NOW(), NOW(),
            $5, CASE WHEN $5::text IS NOT NULL THEN NOW() ELSE NULL END
          )
        `, [email, u.password, plankaRole, u.name || email, termsSig])
        created++
        console.log(`+ created: ${email} (${plankaRole})`)
      } else if (existing.rows[0].password !== u.password) {
        // รหัสผ่านฝั่ง ERP เปลี่ยน → อัปเดตตาม (ERP เป็น source of truth)
        await pg.query(
          'UPDATE user_account SET password = $1, password_changed_at = NOW(), updated_at = NOW() WHERE id = $2',
          [u.password, existing.rows[0].id]
        )
        updated++
        console.log(`~ password synced: ${email}`)
      } else {
        skipped++
      }
    } catch (e) {
      console.error(`! error for ${email}:`, e.message)
    }
  }

  await pg.end()
  console.log(`Done: ${created} created, ${updated} updated, ${skipped} unchanged (${users.length} ERP users)`)
}

main().catch(e => { console.error('Sync failed:', e.message); process.exit(1) })
