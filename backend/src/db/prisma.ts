import dotenv from 'dotenv'
import path from 'path'
import { PrismaClient } from '@prisma/client'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

// Load environment variables BEFORE creating PrismaClient
// Use multiple fallback paths to ensure .env is found
const envPaths = [
  path.resolve(process.cwd(), 'backend', '.env'),
  path.resolve(process.cwd(), '.env'),
  path.resolve(__dirname, '..', '..', '.env'),
]

let envLoaded = false
for (const envPath of envPaths) {
  const result = dotenv.config({ path: envPath })
  if (!result.error) {
    console.log(`✅ Loaded .env from: ${envPath}`)
    envLoaded = true
    break
  }
}

if (!envLoaded) {
  console.warn('⚠️ No .env file found, trying default dotenv.config()')
  dotenv.config()
}

// Verify DATABASE_URL is loaded
if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL not found in environment variables!')
  console.error('Available env vars:', Object.keys(process.env).filter(k => k.includes('DATABASE')))
} else {
  console.log(`✅ DATABASE_URL loaded: ${process.env.DATABASE_URL}`)
}

const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
})

export default prisma
