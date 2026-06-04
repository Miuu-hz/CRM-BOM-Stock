/**
 * One-time Google Drive OAuth2 setup.
 * Run: npx ts-node scripts/setup-gdrive.ts
 *
 * Prerequisites in backend/.env:
 *   GOOGLE_CLIENT_ID=xxx
 *   GOOGLE_CLIENT_SECRET=xxx
 *   GOOGLE_DRIVE_FOLDER_ID=1vxDv8ydftqgWb1lkHjPXMAudd5aRzyXE
 */
import { google } from 'googleapis'
import http from 'http'
import path from 'path'
import dotenv from 'dotenv'

dotenv.config({ path: path.resolve(__dirname, '../.env') })

const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = process.env

if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
  console.error('\n❌  ตั้งค่า GOOGLE_CLIENT_ID และ GOOGLE_CLIENT_SECRET ใน backend/.env ก่อน\n')
  process.exit(1)
}

const REDIRECT_URI = 'http://localhost:3001/callback'
const oauth2 = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, REDIRECT_URI)

const authUrl = oauth2.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent',
  scope: ['https://www.googleapis.com/auth/drive.file'],
})

console.log('\n🔗  เปิด URL นี้ใน browser:\n')
console.log(authUrl)
console.log('\n⏳  รอ authorization...')

const server = http.createServer(async (req, res) => {
  if (!req.url?.startsWith('/callback')) return

  const code = new URL(req.url, 'http://localhost:3001').searchParams.get('code')
  if (!code) {
    res.end('ไม่พบ code กรุณาลองใหม่')
    return
  }

  try {
    const { tokens } = await oauth2.getToken(code)
    res.end(`
      <html><body style="font-family:sans-serif;padding:40px">
        <h2>✅ สำเร็จ! ปิด tab นี้ได้เลย</h2>
        <p>ดู terminal สำหรับ refresh token</p>
      </body></html>
    `)
    server.close()

    console.log('\n✅  เพิ่มบรรทัดนี้ใน backend/.env:\n')
    console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`)
    console.log('\n🚀  Restart backend แล้วระบบ backup พร้อมใช้งาน!\n')
  } catch (err: any) {
    res.end(`Error: ${err.message}`)
    server.close()
    console.error('❌', err.message)
  }
})

server.listen(3001, () => {
  console.log('\n(server รอ callback ที่ port 3001)')
})
