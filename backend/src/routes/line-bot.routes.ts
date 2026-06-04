import { Router, Request, Response } from 'express'
import { getDb } from '../db/sqlite'
import { authenticate, requireMaster } from '../middleware/auth.middleware'
import { lineBotService } from '../services/line-bot.service'

const router = Router()

// ==========================================
// 1. Webhook Endpoint
// ==========================================
// Must parse raw body before here in index.ts
router.post('/webhook', (req: Request, res: Response) => {
    // LINE Platform requires HTTP 200 for ALL webhook requests including verify.
    // Always respond 200 immediately, then process asynchronously.
    res.status(200).end();

    try {
        const signature = req.headers['x-line-signature'] as string;
        if (!signature) return; // no signature → ignore silently

        const tenantId = lineBotService.getTenantFromSignature(signature, req.body);
        if (!tenantId) {
            // Signature didn't match any active tenant — could be LINE verify or unknown channel.
            console.warn('⚠️ Webhook: signature matched no active tenant (may be a verify ping)');
            return;
        }

        const body = JSON.parse(req.body.toString('utf8'));
        const events: any[] = body.events ?? [];

        if (events.length === 0) return; // verify ping — nothing to process

        Promise.all(events.map(event => lineBotService.handleEvent(tenantId, event)))
            .catch(err => console.error('Webhook event processing error:', err));

    } catch (error) {
        console.error('Webhook parse error:', error);
    }
})

// ==========================================
// 2. Settings / Config Endpoints (Auth Required)
// ==========================================

// Get Line Config for Tenant
router.get('/config', authenticate, (req: Request, res: Response) => {
    try {
        const tenantId = req.user!.tenantId;
        const db = getDb();

        const config = db.prepare('SELECT id, channel_name, channel_secret, channel_access_token, is_active FROM line_channels WHERE tenant_id = ?').get(tenantId);

        // Partially hide tokens for security
        let mask = (str: string) => str ? str.substring(0, 5) + '...' + str.substring(str.length - 4) : '';

        if (config) {
            res.json({
                success: true,
                data: {
                    ...config,
                    channel_secret: mask((config as any).channel_secret),
                    channel_access_token: mask((config as any).channel_access_token),
                }
            });
        } else {
            res.json({ success: true, data: null });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch config' });
    }
});

// Update Line Config (Master Only)
// authenticate must come before requireMaster so req.user is populated
router.put('/config', authenticate, requireMaster, (req: Request, res: Response) => {
    try {
        const tenantId = req.user!.tenantId;
        const { channel_name, channel_secret, channel_access_token, is_active } = req.body;
        const db = getDb();

        // SQLite has no boolean type — convert explicitly to 1/0
        const isActiveInt: number = is_active === undefined ? 1 : (is_active ? 1 : 0);
        const name: string = channel_name || 'LINE Bot';

        const existing = db.prepare('SELECT id FROM line_channels WHERE tenant_id = ?').get(tenantId);

        if (existing) {
            // Only update secret/token if a new non-empty value was provided.
            // Allows saving channel_name / is_active without re-entering secrets.
            if (channel_secret && channel_access_token) {
                db.prepare('UPDATE line_channels SET channel_name=?, channel_secret=?, channel_access_token=?, is_active=?, updated_at=CURRENT_TIMESTAMP WHERE tenant_id=?')
                    .run(name, channel_secret, channel_access_token, isActiveInt, tenantId);
            } else if (channel_secret) {
                db.prepare('UPDATE line_channels SET channel_name=?, channel_secret=?, is_active=?, updated_at=CURRENT_TIMESTAMP WHERE tenant_id=?')
                    .run(name, channel_secret, isActiveInt, tenantId);
            } else if (channel_access_token) {
                db.prepare('UPDATE line_channels SET channel_name=?, channel_access_token=?, is_active=?, updated_at=CURRENT_TIMESTAMP WHERE tenant_id=?')
                    .run(name, channel_access_token, isActiveInt, tenantId);
            } else {
                db.prepare('UPDATE line_channels SET channel_name=?, is_active=?, updated_at=CURRENT_TIMESTAMP WHERE tenant_id=?')
                    .run(name, isActiveInt, tenantId);
            }
        } else {
            // New record: both secret and token are mandatory
            if (!channel_secret || !channel_access_token) {
                return res.status(400).json({ success: false, message: 'Channel Secret และ Access Token จำเป็นต้องกรอกสำหรับการตั้งค่าครั้งแรก' });
            }
            db.prepare('INSERT INTO line_channels (id, tenant_id, channel_name, channel_secret, channel_access_token, is_active) VALUES (lower(hex(randomblob(12))), ?, ?, ?, ?, ?)')
                .run(tenantId, name, channel_secret, channel_access_token, isActiveInt);
        }

        res.json({ success: true, message: 'บันทึกการตั้งค่าสำเร็จ' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Failed to update config' });
    }
});

// Test Message Endpoint
router.post('/test', authenticate, async (req: Request, res: Response) => {
    try {
        const tenantId = req.user!.tenantId;
        const role = req.user!.role;

        await lineBotService.pushToRole(tenantId, role, {
            type: 'text',
            text: 'ทดสอบการส่งข้อความจากระบบ 🎉'
        });

        res.json({ success: true, message: 'Test message sent' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to send test message' });
    }
});

// ==========================================
// 3. Account Linking
// ==========================================

// Generate a 6-digit link token (10 min expiry) for the current user
router.post('/link-token', authenticate, (req: Request, res: Response) => {
    try {
        const { tenantId, userId } = req.user!;
        const token = lineBotService.generateLinkToken(tenantId, userId);
        res.json({ success: true, data: { token, expiresInMinutes: 10 } });
    } catch (error) {
        console.error('❌ /link-token error:', error);
        res.status(500).json({ success: false, message: 'Failed to generate link token' });
    }
});

// Get current user's LINE link status
router.get('/link-status', authenticate, (req: Request, res: Response) => {
    try {
        const { tenantId, userId } = req.user!;
        const db = getDb();
        const mapping = db.prepare(
            'SELECT line_user_id, linked_at FROM line_user_mappings WHERE tenant_id = ? AND user_id = ?'
        ).get(tenantId, userId) as any;
        res.json({ success: true, data: { linked: !!mapping, linkedAt: mapping?.linked_at ?? null } });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to get link status' });
    }
});

// List all linked LINE accounts for this tenant (master only)
router.get('/linked-users', authenticate, requireMaster, (req: Request, res: Response) => {
    try {
        const { tenantId } = req.user!;
        const db = getDb();
        const rows = db.prepare(`
            SELECT m.user_id, m.line_user_id, m.role, m.linked_at,
                   u.name as user_name, u.email as user_email
            FROM line_user_mappings m
            LEFT JOIN users u ON u.id = m.user_id
            WHERE m.tenant_id = ?
            ORDER BY m.linked_at DESC
        `).all(tenantId) as any[];
        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('linked-users error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch linked users' });
    }
});

// Unlink current user's LINE account
router.delete('/link', authenticate, (req: Request, res: Response) => {
    try {
        const { tenantId, userId } = req.user!;
        const db = getDb();
        db.prepare('DELETE FROM line_user_mappings WHERE tenant_id = ? AND user_id = ?').run(tenantId, userId);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to unlink' });
    }
});

// Unlink a specific user's LINE account (master only)
router.delete('/link/:userId', authenticate, requireMaster, (req: Request, res: Response) => {
    try {
        const { tenantId } = req.user!;
        const { userId } = req.params;
        const db = getDb();
        db.prepare('DELETE FROM line_user_mappings WHERE tenant_id = ? AND user_id = ?').run(tenantId, userId);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to unlink user' });
    }
});

// ==========================================
// 4. Group Management
// ==========================================

// List all active groups for this tenant
router.get('/groups', authenticate, (req: Request, res: Response) => {
    try {
        const { tenantId } = req.user!;
        const db = getDb();
        const groups = db.prepare(
            'SELECT id, group_id, group_name, is_active, joined_at FROM line_group_mappings WHERE tenant_id = ? ORDER BY joined_at DESC'
        ).all(tenantId);
        res.json({ success: true, data: groups });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch groups' });
    }
});

// Toggle group active status
router.patch('/groups/:groupId', authenticate, requireMaster, (req: Request, res: Response) => {
    try {
        const { tenantId } = req.user!;
        const { groupId } = req.params;
        const { is_active } = req.body;
        const db = getDb();
        db.prepare(
            'UPDATE line_group_mappings SET is_active = ? WHERE tenant_id = ? AND group_id = ?'
        ).run(is_active ? 1 : 0, tenantId, groupId);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to update group' });
    }
});

export default router
