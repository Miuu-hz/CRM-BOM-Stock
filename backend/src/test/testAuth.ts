import jwt from 'jsonwebtoken'
import db from '../db/sqlite'
import { generateId } from '../utils/id'
import type { Role } from '../config/roles'

/**
 * Seeds a real `users` row and signs a real access-token JWT for it, matching exactly
 * what `authenticate` middleware expects (see src/middleware/auth.middleware.ts).
 * Used by route-level integration tests so they exercise the real auth path instead of
 * a mocked req.user.
 */
export function createTestUser(overrides: { role?: Role; tenantId?: string; email?: string } = {}) {
  const userId = generateId()
  const tenantId = overrides.tenantId || generateId()
  const email = overrides.email || `test-${userId}@example.com`
  const role: Role = overrides.role || 'MASTER'

  db.prepare(`
    INSERT INTO users (id, email, password, name, role, tenant_id, status)
    VALUES (?, ?, 'x', 'Test User', ?, ?, 'active')
  `).run(userId, email, role, tenantId)

  const token = jwt.sign({ userId, email, role, tenantId }, process.env.JWT_SECRET!, { expiresIn: '1h' })

  return { userId, tenantId, email, role, token }
}
