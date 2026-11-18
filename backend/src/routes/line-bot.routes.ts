import { Router, Request, Response } from 'express'
import { getDb } from '../db/sqlite'
import { authenticate, requireMaster, requireRole } from '../middleware/auth.middleware'
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

        if (!lineBotService.verifySignature(signature, req.body)) {
            console.warn('⚠️ Webhook: signature ไม่ตรงกับ OA กลาง');
            return;
        }

        const body = JSON.parse(req.body.toString('utf8'));
        const events: any[] = body.events ?? [];

        if (events.length === 0) return; // verify ping — nothing to process

        // OA กลาง: ร้านของแต่ละ event มาจากบัญชี/กลุ่มที่ผูกด้วยรหัส 6 หลัก ไม่ใช่จากช่อง
        Promise.all(events.map(event => lineBotService.handleEvent(lineBotService.resolveTenant(event), event)))
            .catch(err => console.error('Webhook event processing error:', err));

    } catch (error) {
        console.error('Webhook parse error:', error);
    }
})

// ==========================================
// 2. Settings / Config Endpoints (Auth Required)
// ==========================================

// Get Line Config for Tenant (ADMIN/MASTER เท่านั้น — แท็บ LINE ใน Settings โชว์ให้ 2 role นี้)
router.get('/config', authenticate, requireRole('ADMIN', 'MASTER'), (req: Request, res: Response) => {
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
            // ทุกร้านใช้ OA กลาง Phopy-ERP — ห้ามสร้างช่องรายร้าน (webhook จะเลือกช่องไม่ถูก)
            return res.status(409).json({ success: false, message: 'ระบบใช้ LINE OA กลาง Phopy-ERP แล้ว ไม่ต้องตั้งค่าช่องของร้านเอง' })
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
// push ใช้โควตากลาง 300/เดือน → เฉพาะผู้ดูแล
router.post('/test', authenticate, requireRole('ADMIN'), async (req: Request, res: Response) => {
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
        // Master: LINE ลอย ไม่ผูกกับบริษัท → อยู่ใน line_master_links
        const ml = userId.startsWith('master_')
            ? db.prepare('SELECT linked_at FROM line_master_links WHERE master_id = ?').get(userId) as any
            : undefined;
        const found = mapping ?? ml;
        res.json({ success: true, data: { linked: !!found, linkedAt: found?.linked_at ?? null } });
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
// GET /api/line/logs — บันทึกการทำงานของ LINE ของร้านนี้ (ใหม่ก่อน) · ?limit=1..200 &before=<created_at> &status=ERROR
router.get('/logs', authenticate, requireRole('ADMIN', 'MASTER'), (req: Request, res: Response) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200)
    const before = typeof req.query.before === 'string' ? req.query.before : '9'
    const status = req.query.status === 'ERROR' ? 'ERROR' : null
    const rows = getDb().prepare(`
        SELECT id, direction, kind, source_type, target, summary, status, error, duration_ms, created_at
        FROM line_event_logs
        WHERE tenant_id = ? AND created_at < ? AND (? IS NULL OR status = ?)
        ORDER BY created_at DESC, id DESC LIMIT ?
    `).all(req.user!.tenantId, before, status, status, limit)
    res.json({ success: true, data: rows })
})

router.delete('/link', authenticate, (req: Request, res: Response) => {
    try {
        const { tenantId, userId } = req.user!;
        const db = getDb();
        db.prepare('DELETE FROM line_user_mappings WHERE tenant_id = ? AND user_id = ?').run(tenantId, userId);
        if (userId.startsWith('master_')) db.prepare('DELETE FROM line_master_links WHERE master_id = ?').run(userId);
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
        if (userId.startsWith('master_')) db.prepare('DELETE FROM line_master_links WHERE master_id = ?').run(userId);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to unlink user' });
    }
});

// ==========================================
// 4. Public Company Logo Endpoint (No Auth)
// ==========================================
// Serves decoded company logo image for LINE Flex cards and public views
router.get('/logo/:tenantId', (req: Request, res: Response) => {
    try {
        const { tenantId } = req.params;
        const db = getDb();
        const row = db.prepare('SELECT logo_base64 FROM company_settings WHERE tenant_id = ?').get(tenantId) as { logo_base64?: string } | undefined;

        if (!row?.logo_base64 || !row.logo_base64.trim()) {
            return res.status(404).json({ success: false, message: 'Logo not found' });
        }

        let mime = 'image/png';
        let base64Data = row.logo_base64;
        const match = row.logo_base64.match(/^data:([^;]+);base64,(.+)$/);
        if (match) {
            mime = match[1];
            base64Data = match[2];
        }

        const buffer = Buffer.from(base64Data, 'base64');
        if (!buffer.length) {
            return res.status(404).json({ success: false, message: 'Logo not found' });
        }

        if (!match) {
            if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
                mime = 'image/png';
            } else if (buffer.length >= 3 && buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
                mime = 'image/jpeg';
            }
        }

        // โลโก้มาจากผู้ใช้ และ route นี้เปิดสาธารณะ — เสิร์ฟเฉพาะรูป ไม่งั้น data:text/html จะกลายเป็นหน้าเว็บบนโดเมนเรา
        if (!['image/png', 'image/jpeg'].includes(mime)) {
            return res.status(404).json({ success: false, message: 'Logo not found' });
        }
        res.set({
            'Content-Type': mime,
            'X-Content-Type-Options': 'nosniff',
            'Cache-Control': 'public, max-age=86400',
        }).send(buffer);
    } catch (error) {
        console.error('Error serving company logo:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch logo' });
    }
});

export default router
