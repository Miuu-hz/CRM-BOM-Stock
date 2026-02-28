import dotenv from 'dotenv'
import path from 'path'
import { PrismaClient } from '@prisma/client'

// FORCE load .env immediately
dotenv.config({ path: path.join(process.cwd(), 'backend', '.env') })

// FALLBACK: If DATABASE_URL is still not set, use hardcoded path
if (!process.env.DATABASE_URL) {
  console.warn('⚠️ DATABASE_URL not found in .env, using fallback: file:./dev.db')
  process.env.DATABASE_URL = 'file:./dev.db'
}

console.log('🔍 DATABASE_URL:', process.env.DATABASE_URL)
console.log('🔍 Current working directory:', process.cwd())

const prisma = new PrismaClient({
  log: ['error', 'warn'],
})

export default prisma
