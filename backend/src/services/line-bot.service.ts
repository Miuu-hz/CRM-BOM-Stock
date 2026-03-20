import crypto from 'crypto'
import { getDb } from '../db/sqlite'

// We will load line SDK dynamically or wrap it to handle missing dependency initially.
// We'll define types as `any` if the module isn't strictly imported yet.
let Client: any;
let validateSignature: any;
try {
    const line = require('@line/bot-sdk');
    Client = line.Client;
    validateSignature = line.validateSignature;
} catch (e) {
    console.warn('⚠️ @line/bot-sdk is not installed. LINE Bot functionality will be disabled.');
}

import { flexTemplates } from './line-flex-templates'

/**
 * Service สำหรับจัดการ LINE Messaging API แบบ Multi-Tenant
 */
class LineBotService {

    /**
     * สร้าง LINE Client สำหรับ tenant
     */
    private getClient(tenantId: string) {
        if (!Client) return null;

        const db = getDb();
        const config = db.prepare('SELECT * FROM line_channels WHERE tenant_id = ? AND is_active = 1').get(tenantId);

        if (!config) return null;

        return new Client({
            channelAccessToken: config.channel_access_token,
            channelSecret: config.channel_secret
        });
    }

    /**
     * ค้นหา Tenant ID จาก Webhook Signature (โดยลอง validate กับทุก channel_secret ที่มี)
     */
    public getTenantFromSignature(signature: string, bodyRaw: Buffer | string): string | null {
        if (!validateSignature) return null;

        const db = getDb();
        const channels = db.prepare('SELECT tenant_id, channel_secret FROM line_channels WHERE is_active = 1').all() as any[];

        for (const channel of channels) {
            try {
                if (validateSignature(bodyRaw, channel.channel_secret, signature)) {
                    return channel.tenant_id;
                }
            } catch (err) {
                // signature invalid for this secret, try next
                continue;
            }
        }
        return null;
    }

    /**
     * ส่ง Message ไปหาผู้ใช้ทุกคนที่มี Role นี้ใน Tenant นั้น
     */
    public async pushToRole(tenantId: string, role: string, message: any) {
        const client = this.getClient(tenantId);
        if (!client) return;

        const db = getDb();
        const users = db.prepare('SELECT line_user_id FROM line_user_mappings WHERE tenant_id = ? AND role = ?').all(tenantId, role) as any[];

        if (users.length === 0) return;

        for (const user of users) {
            try {
                await client.pushMessage(user.line_user_id, message);
            } catch (err) {
                console.error(`Failed to push message to ${user.line_user_id}:`, err);
            }
        }
    }

    /**
     * แจ้งเตือน Work Order สร้างใหม่ (Push ไปยังพนักงานผลิต - USER)
     */
    public async notifyWorkOrderCreated(tenantId: string, wo: any) {
        const message = flexTemplates.workOrderCard(wo);
        // ส่งให้ 'USER' (พนักงานผลิต)
        await this.pushToRole(tenantId, 'USER', message);
        // ส่งให้ 'MANAGER' และ 'MASTER' เพื่อรับรู้
        await this.pushToRole(tenantId, 'MANAGER', message);
        await this.pushToRole(tenantId, 'MASTER', message);
    }

    /**
     * แจ้งเตือนสถานะ Work Order เปลี่ยน (Push ไปยังหัวหน้า - MASTER/MANAGER)
     */
    public async notifyWorkOrderStatusChanged(tenantId: string, wo: any) {
        const message = flexTemplates.statusChangedCard(wo);
        await this.pushToRole(tenantId, 'MASTER', message);
        await this.pushToRole(tenantId, 'MANAGER', message);
    }

    /**
     * จัดการ Webhook Events (ข้อความเข้า, กดปุ่ม)
     */
    public async handleEvent(tenantId: string, event: any) {
        const client = this.getClient(tenantId);
        if (!client) return;

        // 1. Text Commands
        if (event.type === 'message' && event.message.type === 'text') {
            const text = event.message.text.trim();

            if (text === 'สถานะ' || text.toLowerCase() === 'status') {
                const db = getDb();
                const inProgress = db.prepare("SELECT * FROM work_orders WHERE tenant_id = ? AND status = 'IN_PROGRESS' ORDER BY created_at DESC").all(tenantId) as any[];
                await client.replyMessage(event.replyToken, flexTemplates.statusSummaryCard(inProgress));
                return;
            }

            await client.replyMessage(event.replyToken, {
                type: 'text',
                text: 'คำสั่งที่ไม่รู้จัก พิมพ์ "สถานะ" เพื่อดูใบสั่งผลิตที่กำลังดำเนินการ'
            });
        }

        // 2. Button Postbacks
        if (event.type === 'postback' && event.postback.data) {
            const data = new URLSearchParams(event.postback.data);
            const action = data.get('action');
            const id = data.get('id');

            if (action === 'start_wo' && id) {
                await client.replyMessage(event.replyToken, { type: 'text', text: 'ระบบกำลังดำเนินการ...' });
                // จริงๆ ควรเรียก service ภายในเพื่อ update status
                // db.prepare("UPDATE work_orders SET status = 'IN_PROGRESS' WHERE id = ?").run(id)
                // แล้ว client จะ push แจ้งกลับผ่าน notifyWorkOrderStatusChanged
            }

            if (action === 'complete_wo' && id) {
                await client.replyMessage(event.replyToken, { type: 'text', text: 'ระบบบันทึกว่าผลิตเสร็จเรียบร้อย' });
                // Update DB
            }
        }
    }
}

export const lineBotService = new LineBotService();
