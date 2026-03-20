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
    try {
        const signature = req.headers['x-line-signature'] as string;
        if (!signature) {
            return res.status(400).send('Bad Request');
        }

        // Identify tenant from signature using raw body
        const tenantId = lineBotService.getTenantFromSignature(signature, req.body);

        if (!tenantId) {
            // Failed to validate against any known tenant's secret
            console.warn('⚠️ Webhook validation failed or tenant not found');
            return res.status(401).send('Unauthorized');
        }

        // Proceed to handle events
        // (Note: the raw body must be JSON.parse'd into req.body if it's a buffer.
        // If we used express.raw(), req.body is a Buffer.)
        const events = JSON.parse(req.body.toString('utf8')).events;

        Promise.all(events.map((event: any) => lineBotService.handleEvent(tenantId, event)))
            .then(() => res.status(200).end())
            .catch((err) => {
                console.error('Error handling event:', err);
                res.status(500).end();
            });
    } catch (error) {
        console.error('Webhook error:', error);
        res.status(500).end();
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
router.put('/config', requireMaster, (req: Request, res: Response) => {
    try {
        const tenantId = req.user!.tenantId;
        const { channel_name, channel_secret, channel_access_token, is_active } = req.body;
        const db = getDb();

        if (!channel_secret || !channel_access_token) {
            return res.status(400).json({ success: false, message: 'Secret and Access Token are required' });
        }

        const existing = db.prepare('SELECT id FROM line_channels WHERE tenant_id = ?').get(tenantId);

        if (existing) {
            db.prepare('UPDATE line_channels SET channel_name=?, channel_secret=?, channel_access_token=?, is_active=?, updated_at=CURRENT_TIMESTAMP WHERE tenant_id=?')
                .run(channel_name || 'LINE Bot', channel_secret, channel_access_token, is_active === undefined ? 1 : is_active, tenantId);
        } else {
            db.prepare('INSERT INTO line_channels (id, tenant_id, channel_name, channel_secret, channel_access_token, is_active) VALUES (lower(hex(randomblob(12))), ?, ?, ?, ?, ?)')
                .run(tenantId, channel_name || 'LINE Bot', channel_secret, channel_access_token, is_active === undefined ? 1 : is_active);
        }

        res.json({ success: true, message: 'Updated config' });
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

export default router
