// ─── Phopy card kit (โทนเดียวกับ shiftCloseCard: คราม/มะม่วง/ทราย) ─────────────
const APP_URL = process.env.APP_URL ?? 'https://erp.phopy.net'
const P = {
    indigo: '#3949E5', indigo50: '#EEF0FE', indigoSoft: '#DDE1FD', mango: '#F5A524', mango600: '#D9881A', mango50: '#FEF4E2',
    ink900: '#1E1B16', ink500: '#6B6658', sand100: '#F5F0E2', sand200: '#ECE6D8',
    danger: '#DC2626', danger50: '#FEE2E2', success: '#16A34A', success50: '#DCFCE7',
}
const baht = (n: number) => `฿${(Number(n) || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 })}`
const thDate = (iso: string) => new Date(iso.length === 10 ? `${iso}T00:00:00+07:00` : iso)
    .toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit', timeZone: 'Asia/Bangkok' })
// LINE ปฏิเสธ text ว่าง — กันไว้ที่เดียว
const txt = (text: any, o: Record<string, any> = {}) => ({ type: 'text', text: String(text ?? '') || '-', ...o })
const pill = (label: string, action: any, primary: boolean) => ({
    type: 'box', layout: 'vertical', cornerRadius: 'xxl', paddingTop: '11px', paddingBottom: '11px',
    backgroundColor: primary ? P.indigo : P.sand100, action,
    contents: [txt(label, { size: 'sm', weight: 'bold', align: 'center', color: primary ? '#FFFFFF' : P.indigo })],
})
const uriBtn = (label: string, uri: string, primary = false) => pill(label, { type: 'uri', label, uri }, primary)
const msgBtn = (label: string, text: string, primary = false) => pill(label, { type: 'message', label, text }, primary)
const sectionTitle = (title: string) => txt(title, { size: 'sm', weight: 'bold', color: P.ink900, margin: 'xl' })
const kv = (k: string, v: string, color = P.ink900) => ({
    type: 'box', layout: 'horizontal', margin: 'sm',
    contents: [txt(k, { size: 'sm', color: P.ink500, flex: 1, wrap: true }), txt(v, { size: 'sm', weight: 'bold', color, flex: 0, align: 'end' })],
})
const hero = (label: string, value: string, note = '', bg = P.indigo50, color = P.ink900) => ({
    type: 'box', layout: 'vertical', backgroundColor: bg, cornerRadius: '20px', paddingAll: '14px',
    contents: [
        txt(label, { size: 'xxs', color: P.ink500, weight: 'bold' }),
        { type: 'box', layout: 'baseline', spacing: 'sm', contents: [
            txt(value, { size: 'xxl', weight: 'bold', color, flex: 0 }),
            ...(note ? [txt(note, { size: 'xs', color: P.ink500 })] : []),
        ] },
    ],
})
const tiles = (items: [string, string, string][]) => ({
    type: 'box', layout: 'horizontal', spacing: 'sm', margin: 'md',
    contents: items.map(([label, value, color]) => ({
        type: 'box', layout: 'vertical', backgroundColor: P.sand100, cornerRadius: '14px', paddingAll: '8px',
        contents: [txt(label, { size: 'xxs', color: P.ink500 }), txt(value, { size: 'md', weight: 'bold', color })],
    })),
})
/** แถวรายการ: [เลขลำดับ] ชื่อ/บรรทัดรอง ........ ค่าด้านขวา */
const listRow = (title: string, sub: string, right: string, rightColor: string, n?: number) => ({
    type: 'box', layout: 'horizontal', spacing: 'md', alignItems: 'center', margin: 'md',
    contents: [
        ...(n ? [{ type: 'box', layout: 'vertical', width: '22px', height: '22px', cornerRadius: '8px', backgroundColor: P.indigo50,
            justifyContent: 'center', contents: [txt(n, { size: 'xxs', weight: 'bold', color: P.indigo, align: 'center' })] }] : []),
        { type: 'box', layout: 'vertical', flex: 1, contents: [
            txt(title, { size: 'sm', weight: 'bold', color: P.ink900, wrap: true }),
            ...(sub ? [txt(sub, { size: 'xxs', color: P.ink500, wrap: true })] : []),
        ] },
        ...(right ? [txt(right, { size: 'sm', weight: 'bold', color: rightColor, flex: 0 })] : []),
    ],
})
const barRow = (title: string, sub: string, amount: number, max: number, i: number) => ({
    type: 'box', layout: 'vertical', margin: 'md', contents: [
        { type: 'box', layout: 'horizontal', contents: [
            txt(title, { size: 'sm', weight: 'bold', color: P.ink900, flex: 1 }),
            txt(sub, { size: 'xxs', color: P.ink500, flex: 0, gravity: 'center' }),
            txt(baht(amount), { size: 'sm', weight: 'bold', color: P.ink900, flex: 0, margin: 'md' }),
        ] },
        { type: 'box', layout: 'vertical', height: '4px', backgroundColor: P.sand100, cornerRadius: '4px', margin: 'xs', contents: [
            { type: 'box', layout: 'vertical', height: '4px', cornerRadius: '4px', backgroundColor: i === 0 ? P.indigo : P.mango,
              width: `${Math.max(4, Math.round((amount / (max || 1)) * 100))}%`, contents: [] },
        ] },
    ],
})
function card(o: { alt: string; kicker: string; title: string; sub?: string; body: any[]; buttons?: any[]; tone?: string }) {
    return {
        type: 'flex', altText: o.alt.slice(0, 400),
        contents: {
            type: 'bubble', size: 'mega',
            header: {
                type: 'box', layout: 'vertical', backgroundColor: o.tone ?? P.indigo, paddingAll: '18px', spacing: 'xs',
                contents: [
                    txt(o.kicker, { size: 'xxs', weight: 'bold', color: '#FFFFFFCC' }),
                    txt(o.title, { size: 'lg', weight: 'bold', color: '#FFFFFF', wrap: true }),
                    ...(o.sub ? [txt(o.sub, { size: 'xxs', color: '#FFFFFFCC', wrap: true })] : []),
                ],
            },
            body: { type: 'box', layout: 'vertical', paddingAll: '16px', contents: o.body },
            ...(o.buttons?.length ? { footer: {
                type: 'box', layout: 'vertical', spacing: 'sm', paddingStart: '16px', paddingEnd: '16px', paddingBottom: '16px', paddingTop: '4px',
                contents: o.buttons,
            } } : {}),
        },
    }
}

export const APPROVAL_MODULES: Record<string, { label: string; icon: string; bg: string; color: string }> = {
    stock_adjust:      { label: 'ปรับ/เปลี่ยนสต็อก',  icon: '📦', bg: '#EEF2FF', color: '#4F46E5' },
    pos_void:          { label: 'ยกเลิกบิล POS',     icon: '🧾', bg: '#FFF7ED', color: '#EA580C' },
    pos_discount:      { label: 'ส่วนลดหน้าร้าน POS', icon: '🏷️', bg: '#FEF3C7', color: '#D97706' },
    doc_edit:          { label: 'แก้ไขเอกสาร',       icon: '✏️', bg: '#FAF5FF', color: '#9333EA' },
    sales_order:       { label: 'คำสั่งขาย',         icon: '🛒', bg: '#ECFEFF', color: '#0891B2' },
    sales_cancel:      { label: 'ยกเลิกเอกสารขาย',   icon: '🚫', bg: '#FEF2F2', color: '#DC2626' },
    purchase_cancel:   { label: 'ยกเลิกเอกสารซื้อ',  icon: '🚫', bg: '#FEF2F2', color: '#DC2626' },
    purchase_order:    { label: 'ใบสั่งซื้อ',         icon: '🛍️', bg: '#F0FDF4', color: '#16A34A' },
    purchase_request:  { label: 'ใบขอซื้อ',          icon: '📄', bg: '#FEF3C7', color: '#D97706' },
    work_orders:       { label: 'ใบสั่งผลิต',        icon: '🏭', bg: '#F1F5F9', color: '#475569' },
}

export const flexTemplates = {
    // 1. Work Order Card (ใบสั่งผลิต)
    workOrderCard: (wo: any) => ({
        type: 'flex',
        altText: `ใบสั่งผลิตใหม่: ${wo.wo_number}`,
        contents: {
            type: 'bubble',
            size: 'mega',
            header: {
                type: 'box',
                layout: 'vertical',
                contents: [
                    {
                        type: 'text',
                        text: '📋 ใบสั่งผลิตใหม่',
                        weight: 'bold',
                        size: 'xl',
                        color: '#ffffff'
                    }
                ],
                backgroundColor: '#0066cc',
                paddingAll: '15px'
            },
            body: {
                type: 'box',
                layout: 'vertical',
                contents: [
                    {
                        type: 'text',
                        text: wo.wo_number,
                        weight: 'bold',
                        size: 'lg',
                        margin: 'md'
                    },
                    {
                        type: 'box',
                        layout: 'vertical',
                        margin: 'lg',
                        spacing: 'sm',
                        contents: [
                            {
                                type: 'box',
                                layout: 'baseline',
                                spacing: 'sm',
                                contents: [
                                    { type: 'text', text: 'สินค้า', color: '#aaaaaa', size: 'sm', flex: 1 },
                                    { type: 'text', text: wo.product_name, wrap: true, color: '#666666', size: 'sm', flex: 3 }
                                ]
                            },
                            {
                                type: 'box',
                                layout: 'baseline',
                                spacing: 'sm',
                                contents: [
                                    { type: 'text', text: 'จำนวน', color: '#aaaaaa', size: 'sm', flex: 1 },
                                    { type: 'text', text: `${wo.quantity}`, wrap: true, color: '#666666', size: 'sm', flex: 3 }
                                ]
                            },
                            {
                                type: 'box',
                                layout: 'baseline',
                                spacing: 'sm',
                                contents: [
                                    { type: 'text', text: 'วันที่', color: '#aaaaaa', size: 'sm', flex: 1 },
                                    { type: 'text', text: new Date(wo.created_at).toLocaleDateString('th-TH'), wrap: true, color: '#666666', size: 'sm', flex: 3 }
                                ]
                            }
                        ]
                    }
                ]
            },
            footer: {
                type: 'box',
                layout: 'vertical',
                spacing: 'sm',
                contents: [
                    {
                        type: 'button',
                        style: 'primary',
                        height: 'sm',
                        action: {
                            type: 'uri',
                            label: 'เปิดใบสั่งผลิต',
                            uri: `${APP_URL}/work-orders`
                        }
                    }
                ],
                flex: 0
            }
        }
    }),

    // 2. Status Changed Card
    statusChangedCard: (wo: any) => {
        let title = 'อัปเดตสถานะ';
        let bgColor = '#666666';

        switch (wo.status) {
            case 'IN_PROGRESS':
                title = '🏭 กำลังผลิต';
                bgColor = '#ff9900';
                break;
            case 'COMPLETED':
                title = '✅ ผลิตเสร็จสิ้น';
                bgColor = '#00cc66';
                break;
            case 'ON_HOLD':
                title = '⏸️ หยุดชั่วคราว';
                bgColor = '#cc0000';
                break;
        }

        const footerButtons: any[] = [];
        if (wo.status === 'IN_PROGRESS') {
            footerButtons.push({
                type: 'button',
                style: 'primary',
                height: 'sm',
                color: '#00cc66',
                action: {
                    type: 'uri',
                    label: 'เปิดใบสั่งผลิต',
                    uri: `${APP_URL}/work-orders`
                }
            });
        }

        const card: any = {
            type: 'flex',
            altText: `อัปเดตสถานะ: ${wo.wo_number}`,
            contents: {
                type: 'bubble',
                header: {
                    type: 'box',
                    layout: 'vertical',
                    contents: [{ type: 'text', text: title, weight: 'bold', color: '#ffffff', size: 'lg' }],
                    backgroundColor: bgColor
                },
                body: {
                    type: 'box',
                    layout: 'vertical',
                    contents: [
                        { type: 'text', text: wo.wo_number, weight: 'bold', size: 'md' },
                        { type: 'text', text: `สินค้า: ${wo.product_name}`, size: 'sm', margin: 'md', color: '#666666' },
                        { type: 'text', text: `เป้าหมาย: ${wo.quantity}`, size: 'sm', color: '#666666' }
                    ]
                }
            }
        };

        if (footerButtons.length > 0) {
            card.contents.footer = {
                type: 'box',
                layout: 'vertical',
                contents: footerButtons
            };
        }

        return card;
    },

    // 3. PR Draft Card — ส่งทันทีหลัง parse ได้
    prDraftCard: (pr: { prNumber: string; supplierName: string; items: string[]; webUrl: string }) => ({
        type: 'flex',
        altText: `📋 ใบขอซื้อ ${pr.prNumber} — รอกรอกรายละเอียดในเว็บ`,
        contents: {
            type: 'bubble',
            size: 'kilo',
            header: {
                type: 'box', layout: 'vertical', backgroundColor: '#1a73e8', paddingAll: '14px',
                contents: [
                    { type: 'text', text: '📋 ใบขอซื้อ (PR) สร้างแล้ว', weight: 'bold', color: '#ffffff', size: 'md' },
                    { type: 'text', text: pr.prNumber, color: '#cce0ff', size: 'sm', margin: 'xs' },
                ]
            },
            body: {
                type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '14px',
                contents: [
                    {
                        type: 'box', layout: 'baseline', spacing: 'sm',
                        contents: [
                            { type: 'text', text: 'ซัพพลายเออร์', color: '#888888', size: 'sm', flex: 3 },
                            { type: 'text', text: pr.supplierName, size: 'sm', flex: 5, weight: 'bold', wrap: true },
                        ]
                    },
                    { type: 'separator', margin: 'md' },
                    { type: 'text', text: 'รายการที่ขอซื้อ:', size: 'sm', color: '#444444', margin: 'md', weight: 'bold' },
                    ...pr.items.slice(0, 8).map((name, i) => ({
                        type: 'box' as const, layout: 'baseline' as const, spacing: 'sm' as const,
                        contents: [
                            { type: 'text' as const, text: `${i + 1}.`, size: 'xs' as const, color: '#aaaaaa', flex: 1 },
                            { type: 'text' as const, text: name, size: 'sm' as const, color: '#333333', flex: 9, wrap: true },
                        ]
                    })),
                    ...(pr.items.length > 8 ? [{
                        type: 'text' as const, text: `+ อีก ${pr.items.length - 8} รายการ`,
                        size: 'xs' as const, color: '#aaaaaa', margin: 'sm' as const
                    }] : []),
                    { type: 'separator', margin: 'md' },
                    {
                        type: 'box', layout: 'horizontal', margin: 'md',
                        contents: [
                            { type: 'text', text: '⚠️ ยังไม่ได้กรอกจำนวน/ราคา', size: 'xs', color: '#e67700', wrap: true, flex: 1 }
                        ]
                    }
                ]
            },
            footer: {
                type: 'box', layout: 'vertical', paddingAll: '10px',
                contents: [{
                    type: 'button', style: 'primary', color: '#1a73e8', height: 'sm',
                    action: { type: 'uri', label: '📝 กรอกรายละเอียดในเว็บ', uri: pr.webUrl }
                }]
            }
        }
    }),

    // 3b. PR Status Update Card — push กลับหลังอนุมัติ/ปฏิเสธบนเว็บ
    prStatusCard: (pr: {
        prNumber: string; supplierName: string; status: 'APPROVED' | 'REJECTED';
        approverName: string; rejectionReason?: string; webUrl: string
    }) => {
        const approved = pr.status === 'APPROVED'
        return {
            type: 'flex',
            altText: `${approved ? '✅' : '❌'} PR ${pr.prNumber} ${approved ? 'อนุมัติแล้ว' : 'ถูกปฏิเสธ'}`,
            contents: {
                type: 'bubble', size: 'kilo',
                header: {
                    type: 'box', layout: 'vertical',
                    backgroundColor: approved ? '#00aa55' : '#cc2222', paddingAll: '14px',
                    contents: [{
                        type: 'text',
                        text: approved ? '✅ ใบขอซื้ออนุมัติแล้ว' : '❌ ใบขอซื้อถูกปฏิเสธ',
                        weight: 'bold', color: '#ffffff', size: 'md'
                    }]
                },
                body: {
                    type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '14px',
                    contents: [
                        {
                            type: 'box', layout: 'baseline', spacing: 'sm',
                            contents: [
                                { type: 'text', text: 'เลขที่', color: '#888888', size: 'sm', flex: 3 },
                                { type: 'text', text: pr.prNumber, size: 'sm', flex: 5, weight: 'bold' },
                            ]
                        },
                        {
                            type: 'box', layout: 'baseline', spacing: 'sm',
                            contents: [
                                { type: 'text', text: 'ซัพพลายเออร์', color: '#888888', size: 'sm', flex: 3 },
                                { type: 'text', text: pr.supplierName, size: 'sm', flex: 5, wrap: true },
                            ]
                        },
                        {
                            type: 'box', layout: 'baseline', spacing: 'sm',
                            contents: [
                                { type: 'text', text: approved ? 'อนุมัติโดย' : 'ปฏิเสธโดย', color: '#888888', size: 'sm', flex: 3 },
                                { type: 'text', text: pr.approverName, size: 'sm', flex: 5, weight: 'bold' },
                            ]
                        },
                        ...(!approved && pr.rejectionReason ? [{
                            type: 'box' as const, layout: 'baseline' as const, spacing: 'sm' as const, margin: 'sm' as const,
                            contents: [
                                { type: 'text' as const, text: 'เหตุผล', color: '#888888', size: 'sm' as const, flex: 3 },
                                { type: 'text' as const, text: pr.rejectionReason, size: 'sm' as const, flex: 5, wrap: true, color: '#cc2222' },
                            ]
                        }] : []),
                    ]
                },
                footer: {
                    type: 'box', layout: 'vertical', paddingAll: '10px',
                    contents: [{
                        type: 'button', style: 'secondary', height: 'sm',
                        action: { type: 'uri', label: '🔗 ดู PR ในเว็บ', uri: pr.webUrl }
                    }]
                }
            }
        }
    },

    // 3c. BOM Draft Card — ส่งกลับหลังสร้าง BOM Draft จาก LINE
    bomDraftCard: (bom: {
        productName: string; version: string
        items: { name: string; qty: number; unit: string }[]
        newItems: string[]   // รายชื่อ item ที่ไม่พบใน stock (สร้าง placeholder)
        webUrl: string
    }) => ({
        type: 'flex',
        altText: `🏭 BOM Draft: ${bom.productName} ${bom.version} — รอแก้ไขในเว็บ`,
        contents: {
            type: 'bubble', size: 'kilo',
            header: {
                type: 'box', layout: 'vertical', backgroundColor: '#0d6e4a', paddingAll: '14px',
                contents: [
                    { type: 'text', text: '🏭 BOM Draft สร้างแล้ว', weight: 'bold', color: '#ffffff', size: 'md' },
                    { type: 'text', text: `${bom.productName}  ·  ${bom.version}`, color: '#a8f0d0', size: 'sm', margin: 'xs' },
                ]
            },
            body: {
                type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '14px',
                contents: [
                    { type: 'text', text: 'วัตถุดิบที่ระบุ:', size: 'sm', color: '#444444', weight: 'bold' },
                    ...bom.items.slice(0, 8).map((item, i) => ({
                        type: 'box' as const, layout: 'horizontal' as const, spacing: 'sm' as const, margin: 'sm' as const,
                        contents: [
                            { type: 'text' as const, text: `${i + 1}.`, size: 'xs' as const, color: '#aaaaaa', flex: 1 },
                            { type: 'text' as const, text: item.name, size: 'sm' as const, color: '#333333', flex: 6, wrap: true },
                            { type: 'text' as const, text: `${item.qty} ${item.unit}`, size: 'xs' as const, color: '#666666', flex: 3, align: 'end' as const },
                        ]
                    })),
                    ...(bom.items.length > 8 ? [{
                        type: 'text' as const, text: `+ อีก ${bom.items.length - 8} รายการ`,
                        size: 'xs' as const, color: '#aaaaaa', margin: 'sm' as const
                    }] : []),
                    ...(bom.newItems.length > 0 ? [
                        { type: 'separator' as const, margin: 'md' as const },
                        {
                            type: 'box' as const, layout: 'horizontal' as const, margin: 'sm' as const,
                            contents: [{
                                type: 'text' as const,
                                text: `⚠️ ไม่พบใน stock ${bom.newItems.length} รายการ — สร้าง placeholder แล้ว`,
                                size: 'xs' as const, color: '#e67700', wrap: true, flex: 1
                            }]
                        },
                    ] : []),
                    { type: 'separator' as const, margin: 'md' as const },
                    {
                        type: 'box' as const, layout: 'horizontal' as const, margin: 'sm' as const,
                        contents: [{
                            type: 'text' as const,
                            text: '📝 กด "แก้ไข BOM" เพื่อกำหนดจำนวน/หน่วย/ราคาให้ครบ',
                            size: 'xs' as const, color: '#555555', wrap: true, flex: 1
                        }]
                    },
                ]
            },
            footer: {
                type: 'box', layout: 'vertical', paddingAll: '10px',
                contents: [{
                    type: 'button', style: 'primary', color: '#0d6e4a', height: 'sm',
                    action: { type: 'uri', label: '📋 แก้ไข BOM ในเว็บ', uri: bom.webUrl }
                }]
            }
        }
    }),

    // 4. Welcome Card (follow event)
    welcomeCard: () => card({
        alt: 'ยินดีต้อนรับสู่ Phopy ERP · กดเชื่อมบัญชีเพื่อเริ่มใช้งาน',
        kicker: 'Phopy ERP', title: 'สวัสดีครับ 👋', sub: 'ผูก LINE กับบัญชี ERP แล้วเมนูด้านล่างจะเปลี่ยนตามตำแหน่งของคุณ',
        body: [
            sectionTitle('เชื่อมบัญชีใน 3 ขั้น'),
            listRow('เปิด erp.phopy.net', 'ไปที่ ตั้งค่า → LINE Bot', '', P.ink900, 1),
            listRow('กด "สร้างรหัสเชื่อม"', 'ได้รหัส 6 หลัก อายุ 10 นาที', '', P.ink900, 2),
            listRow('ส่งรหัสมาในแชทนี้', 'พิมพ์: ลิงก์ 123456', '', P.ink900, 3),
        ],
        buttons: [uriBtn('เปิด ERP', APP_URL, true), msgBtn('คำสั่งทั้งหมด', 'ช่วยเหลือ')],
    }),

    // 4b. Help Card — แยกตามเมนูของตำแหน่ง
    helpCard: (menu: 'guest' | 'staff' | 'manager' | 'exec') => {
        const cmds: Record<string, [string, string][]> = {
            guest:   [['ลิงก์ [รหัส 6 หลัก]', 'เชื่อมบัญชี LINE กับ ERP'], ['วิธีเชื่อมบัญชี', 'ขั้นตอนขอรหัส']],
            staff:   [['สต็อก [ชื่อ]', 'ค้นหาสินค้าในคลัง'], ['สูตร [ชื่อ]', 'ส่วนผสม + ต้นทุน'], ['สถานะ', 'ใบสั่งผลิตที่กำลังทำ'], ['ออเดอร์', 'ใบสั่งขายล่าสุด'], ['บัญชีของฉัน', 'บริษัทและตำแหน่งที่ผูกไว้']],
            manager: [['รออนุมัติ', 'คำขอที่คุณอนุมัติได้'], ['สต็อกต่ำ', 'ของที่ต่ำกว่าจุดสั่งซื้อ'], ['สต็อก [ชื่อ]', 'ค้นหาสินค้าในคลัง'], ['สถานะ', 'ใบสั่งผลิตที่กำลังทำ'], ['ออเดอร์', 'ใบสั่งขายล่าสุด']],
            exec:    [['ยอดขายวันนี้', 'POS วันนี้เทียบสัปดาห์ก่อน'], ['กำไรเดือนนี้', 'จากสมุดบัญชีที่ลงแล้ว'], ['รออนุมัติ', 'คำขอที่ค้างทั้งหมด'], ['สต็อกต่ำ', 'ของที่ต่ำกว่าจุดสั่งซื้อ'], ['สต็อก [ชื่อ]', 'ค้นหาสินค้าในคลัง']],
        }
        return card({
            alt: 'คำสั่งที่ใช้ได้', kicker: 'Phopy ERP', title: '📖 คำสั่งที่ใช้ได้',
            sub: menu === 'guest' ? 'ยังไม่ได้เชื่อมบัญชี' : 'กดจากเมนูด้านล่าง หรือพิมพ์คำสั่งเองก็ได้',
            body: [
                ...cmds[menu].map(([c, d]) => listRow(c, d, '', P.ink900)),
                ...(menu === 'guest' ? [] : [txt('พิมพ์คำถามอื่นได้เลย ระบบ AI จะช่วยตอบ', { size: 'xxs', color: P.ink500, margin: 'lg', wrap: true })]),
            ],
        })
    },

    // 5. Stock Query Card
    stockQueryCard: (query: string, items: any[]) => {
        if (items.length === 0) {
            return { type: 'text', text: `ไม่พบสินค้าที่ชื่อมี "${query}" ในคลังสินค้าครับ` }
        }
        return card({
            alt: `สต็อก: ${query}`, kicker: '📦 ค้นหาสต็อก', title: query,
            body: items.map(it => listRow(it.name, it.sku || '', `${Number(it.quantity).toLocaleString('th-TH')} ${it.unit || ''}`,
                it.quantity <= 0 ? P.danger : it.status === 'LOW' ? P.mango600 : P.success)),
        })
    },

    // 6. Recent Orders Card
    recentOrdersCard: (orders: any[]) => {
        if (orders.length === 0) {
            return { type: 'text', text: 'ยังไม่มีคำสั่งซื้อในระบบครับ' }
        }
        return card({
            alt: 'คำสั่งซื้อล่าสุด', kicker: '🛒 ออเดอร์', title: 'ใบสั่งขายล่าสุด',
            body: orders.map(o => listRow(o.order_number, o.status, `฿${Number(o.total_amount).toLocaleString()}`, P.ink900)),
            buttons: [uriBtn('เปิดใบสั่งขาย', `${APP_URL}/sales`, false)],
        })
    },

    // 7. Status Summary Card
    statusSummaryCard: (inProgress: any[]) => {
        if (inProgress.length === 0) {
            return { type: 'text', text: 'ตอนนี้ไม่มีรายการที่กำลังผลิตครับ ✨' }
        }
        return card({
            alt: 'สรุปสถานะการผลิต', kicker: '🏭 งานผลิต', title: `กำลังผลิต ${inProgress.length} รายการ`,
            body: [
                ...inProgress.slice(0, 5).map(wo => listRow(wo.wo_number, wo.product_name || '', '', P.ink900)),
                ...(inProgress.length > 5 ? [txt(`... และอีก ${inProgress.length - 5} รายการ`, { size: 'xs', color: P.ink500, margin: 'md' })] : []),
            ],
            buttons: [uriBtn('เปิดใบสั่งผลิต', `${APP_URL}/work-orders`, false)],
        })
    },

    // 8. ยอดขายวันนี้ (ผู้บริหาร) — ตัวเลขจาก posSales() ตัวเดียวกับ Phopy Board
    dailySalesCard: (d: {
        company: string; date: string; revenue: number; bills: number; avgBill: number; discount: number
        byMethod: { label: string; amount: number; count: number }[]; cancelled: { bills: number; amount: number }
        lastWeek: number | null
    }) => {
        const delta = d.lastWeek && d.lastWeek > 0 ? ((d.revenue - d.lastWeek) / d.lastWeek) * 100 : null
        const max = d.byMethod[0]?.amount || 0
        return card({
            alt: `ยอดขายวันนี้ ${baht(d.revenue)} · ${d.bills} บิล${d.company ? ` · ${d.company}` : ''}`,
            kicker: d.company || 'Phopy ERP', title: '📈 ยอดขายวันนี้', sub: thDate(d.date),
            body: [
                hero('ยอดขาย POS ที่ชำระแล้ว', baht(d.revenue), `· ${d.bills} บิล`),
                tiles([
                    ['เฉลี่ย/บิล', baht(d.avgBill), P.ink900],
                    ['เทียบสัปดาห์ก่อน', delta === null ? '–' : `${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta).toFixed(1)}%`,
                        delta === null ? P.ink500 : delta >= 0 ? P.success : P.danger],
                ]),
                sectionTitle('ช่องทางชำระ'),
                ...(d.byMethod.length
                    ? d.byMethod.map((m, i) => barRow(m.label, `${m.count} บิล`, m.amount, max, i))
                    : [txt('ยังไม่มีบิลที่ชำระวันนี้', { size: 'xs', color: P.ink500 })]),
                ...(d.discount > 0 || d.cancelled.bills > 0 ? [
                    sectionTitle('ควรดู'),
                    ...(d.discount > 0 ? [kv('🏷️ ส่วนลดรวม', baht(d.discount), P.mango600)] : []),
                    ...(d.cancelled.bills > 0 ? [kv(`🔴 ยกเลิกบิล ${d.cancelled.bills} ใบ`, baht(d.cancelled.amount), P.danger)] : []),
                ] : []),
            ],
            buttons: [uriBtn('ดูรายการขายวันนี้', `${APP_URL}/accounting/pos-clearing`, true)],
        })
    },

    // 9. กำไรเดือนนี้ (ผู้บริหาร) — ledgerRevenue/Cogs/Opex ตัวเดียวกับ Phopy Board
    monthProfitCard: (d: { company: string; from: string; to: string; revenue: number; cogs: number; opex: number }) => {
        const net = d.revenue - d.cogs - d.opex
        const gm = d.revenue > 0 ? ((d.revenue - d.cogs) / d.revenue) * 100 : 0
        return card({
            alt: `กำไรเดือนนี้ ${baht(net)} · ยอดขาย ${baht(d.revenue)}`,
            kicker: d.company || 'Phopy ERP', title: '💰 กำไรเดือนนี้', sub: `${thDate(d.from)} – ${thDate(d.to)} · จากสมุดบัญชีที่ลงแล้ว`,
            body: [
                hero(net < 0 ? 'ขาดทุนสุทธิ (ก่อนภาษี)' : 'กำไรสุทธิ (ก่อนภาษี)', baht(net), '', net < 0 ? P.danger50 : P.success50, net < 0 ? P.danger : P.ink900),
                kv('รายได้', baht(d.revenue)),
                kv('− ต้นทุนขาย', baht(d.cogs)),
                kv('− ค่าใช้จ่าย', baht(d.opex)),
                { type: 'separator', margin: 'md', color: P.sand200 },
                kv('% กำไรขั้นต้น', `${gm.toFixed(1)}%`, gm < 0 ? P.danger : P.indigo),
            ],
            buttons: [uriBtn('เปิด Phopy Board', `${APP_URL}/accounting/phopy-board`, true)],
        })
    },

    // 10. รออนุมัติ — แสดงเฉพาะคำขอที่คนกดอนุมัติได้จริง (canApprove)
    pendingApprovalsCard: (d: { company: string; total: number; rows: { requestNumber: string; moduleType: string; requesterName: string; amount: number; createdAt: string }[] }) => {
        if (d.total === 0) return { type: 'text', text: '✅ ไม่มีคำขอที่รอคุณอนุมัติครับ' }
        return card({
            alt: `รออนุมัติ ${d.total} รายการ${d.company ? ` · ${d.company}` : ''}`,
            kicker: d.company || 'Phopy ERP', title: `📝 รออนุมัติ ${d.total} รายการ`, tone: P.mango600,
            body: [
                ...d.rows.map(r => {
                    const m = APPROVAL_MODULES[r.moduleType]
                    return listRow(`${m?.icon ?? '📋'} ${m?.label ?? r.moduleType}`, `${r.requestNumber} · ${r.requesterName} · ${thDate(r.createdAt)}`,
                        r.amount > 0 ? baht(r.amount) : '', P.ink900)
                }),
                ...(d.total > d.rows.length ? [txt(`... และอีก ${d.total - d.rows.length} รายการ`, { size: 'xs', color: P.ink500, margin: 'md' })] : []),
            ],
            buttons: [uriBtn('เปิดหน้าอนุมัติ', `${APP_URL}/approvals`, true)],
        })
    },

    // 11. สต็อกต่ำ — getLowStockItems() ตัวเดียวกับแดชบอร์ด (นับแพ็คที่ยังไม่แกะแล้ว)
    lowStockCard: (d: { company: string; total: number; rows: { name: string; available: number; minStock: number; unit: string }[] }) => {
        if (d.total === 0) return { type: 'text', text: '✅ ไม่มีสินค้าที่ต่ำกว่าจุดสั่งซื้อครับ' }
        const fmt = (n: number) => Number(n).toLocaleString('th-TH', { maximumFractionDigits: 2 })
        return card({
            alt: `สต็อกต่ำ ${d.total} รายการ`, kicker: d.company || 'Phopy ERP', title: `⚠️ สต็อกต่ำ ${d.total} รายการ`, tone: P.danger,
            body: [
                ...d.rows.map(r => listRow(r.name, `จุดสั่งซื้อ ${fmt(r.minStock)} ${r.unit || ''}`, `${fmt(r.available)} ${r.unit || ''}`,
                    r.available <= 0 ? P.danger : P.mango600)),
                ...(d.total > d.rows.length ? [txt(`... และอีก ${d.total - d.rows.length} รายการ`, { size: 'xs', color: P.ink500, margin: 'md' })] : []),
            ],
            buttons: [uriBtn('เปิดคลังสินค้า', `${APP_URL}/stock`, true)],
        })
    },

    // 12. บัญชีของฉัน
    meCard: (d: { company: string; name: string; email: string; roleLabel: string; menuLabel: string; linkedAt: string | null }) => card({
        alt: `บัญชีของฉัน · ${d.company}`, kicker: '👤 บัญชีของฉัน', title: d.name || d.email || '-', sub: d.email || undefined,
        body: [
            kv('บริษัท', d.company || '-'),
            kv('ตำแหน่ง', d.roleLabel),
            kv('เมนูที่ใช้', d.menuLabel),
            kv('ผูก LINE เมื่อ', d.linkedAt ? thDate(d.linkedAt) : '-'),
            txt('เปลี่ยนตำแหน่งในเว็บแล้ว เมนูจะเปลี่ยนตามเองในข้อความถัดไป', { size: 'xxs', color: P.ink500, margin: 'lg', wrap: true }),
        ],
        buttons: [uriBtn('เปิด ERP', APP_URL, false)],
    }),

    // ─── Samsung One UI 9 Style: Approval Request Card ───────────────────────
    approvalRequestCard: (req: {
        id: string
        requestNumber: string
        moduleType: string
        requesterName: string
        requesterRole: string
        amount?: number
        description?: string
        createdAt: string
        webUrl: string
    }) => {
        const moduleConfig = APPROVAL_MODULES
        const mod = moduleConfig[req.moduleType] || { label: req.moduleType, icon: '📋', bg: '#F1F5F9', color: '#475569' }

        const amountFormatted = req.amount && req.amount > 0
            ? `฿${Number(req.amount).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
            : null

        const timeStr = new Date(req.createdAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })
        const dateStr = new Date(req.createdAt).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })

        return {
            type: 'flex',
            altText: `🔔 คำขออนุมัติใหม่: ${mod.label} (${req.requestNumber})`,
            contents: {
                type: 'bubble',
                size: 'mega',
                body: {
                    type: 'box',
                    layout: 'vertical',
                    paddingAll: '20px',
                    spacing: 'md',
                    contents: [
                        // One UI Header Row: Pill Badge + Status Pill
                        {
                            type: 'box',
                            layout: 'horizontal',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            contents: [
                                {
                                    type: 'box',
                                    layout: 'horizontal',
                                    backgroundColor: mod.bg,
                                    cornerRadius: 'xxl',
                                    paddingStart: '10px',
                                    paddingEnd: '10px',
                                    paddingTop: '4px',
                                    paddingBottom: '4px',
                                    contents: [
                                        {
                                            type: 'text',
                                            text: `${mod.icon} ${mod.label}`,
                                            size: 'xs',
                                            weight: 'bold',
                                            color: mod.color,
                                        }
                                    ]
                                },
                                {
                                    type: 'box',
                                    layout: 'horizontal',
                                    backgroundColor: '#FEF3C7',
                                    cornerRadius: 'xxl',
                                    paddingStart: '10px',
                                    paddingEnd: '10px',
                                    paddingTop: '4px',
                                    paddingBottom: '4px',
                                    contents: [
                                        {
                                            type: 'text',
                                            text: 'รอการอนุมัติ',
                                            size: 'xxs',
                                            weight: 'bold',
                                            color: '#B45309',
                                        }
                                    ]
                                }
                            ]
                        },
                        // Request Title / Number
                        {
                            type: 'box',
                            layout: 'vertical',
                            margin: 'md',
                            spacing: 'none',
                            contents: [
                                {
                                    type: 'text',
                                    text: req.requestNumber,
                                    size: 'xs',
                                    color: '#94A3B8',
                                    weight: 'bold',
                                },
                                ...(amountFormatted ? [
                                    {
                                        type: 'text' as const,
                                        text: amountFormatted,
                                        size: 'xxl' as const,
                                        weight: 'bold' as const,
                                        color: '#0F172A',
                                        margin: 'xs' as const,
                                    }
                                ] : [
                                    {
                                        type: 'text' as const,
                                        text: 'มีคำขอรอการตรวจสอบ',
                                        size: 'lg' as const,
                                        weight: 'bold' as const,
                                        color: '#0F172A',
                                        margin: 'xs' as const,
                                    }
                                ])
                            ]
                        },
                        // One UI Inset Card (Rounded Squircle Section)
                        {
                            type: 'box',
                            layout: 'vertical',
                            backgroundColor: '#F8FAFC',
                            cornerRadius: '16px',
                            paddingAll: '14px',
                            spacing: 'sm',
                            margin: 'md',
                            contents: [
                                ...(req.description ? [
                                    {
                                        type: 'text' as const,
                                        text: req.description,
                                        size: 'sm' as const,
                                        color: '#334155' as const,
                                        wrap: true as const,
                                        maxLines: 3 as const,
                                    },
                                    {
                                        type: 'separator' as const,
                                        margin: 'sm' as const,
                                        color: '#E2E8F0' as const,
                                    }
                                ] : []),
                                {
                                    type: 'box',
                                    layout: 'horizontal',
                                    justifyContent: 'space-between',
                                    contents: [
                                        {
                                            type: 'text',
                                            text: 'ผู้ขอ',
                                            size: 'xs',
                                            color: '#64748B',
                                            flex: 1,
                                        },
                                        {
                                            type: 'text',
                                            text: `${req.requesterName} (${req.requesterRole})`,
                                            size: 'xs',
                                            color: '#0F172A',
                                            weight: 'bold',
                                            align: 'end',
                                            flex: 3,
                                        }
                                    ]
                                },
                                {
                                    type: 'box',
                                    layout: 'horizontal',
                                    justifyContent: 'space-between',
                                    contents: [
                                        {
                                            type: 'text',
                                            text: 'เวลา',
                                            size: 'xs',
                                            color: '#64748B',
                                            flex: 1,
                                        },
                                        {
                                            type: 'text',
                                            text: `${dateStr} ${timeStr}`,
                                            size: 'xs',
                                            color: '#0F172A',
                                            align: 'end',
                                            flex: 3,
                                        }
                                    ]
                                }
                            ]
                        },
                        // One UI Bottom Pill Action Button
                        {
                            type: 'box',
                            layout: 'vertical',
                            margin: 'lg',
                            contents: [
                                {
                                    type: 'button',
                                    style: 'primary',
                                    height: 'md',
                                    color: '#0072DE',
                                    action: {
                                        type: 'uri',
                                        label: '🔍 ตรวจสอบและอนุมัติ',
                                        uri: `${req.webUrl}/approvals`,
                                    }
                                }
                            ]
                        }
                    ]
                }
            }
        }
    },

    // ─── Samsung One UI 9 Style: Approval Decision Card (ส่งกลับหาผู้ขอ) ──────
    approvalDecisionCard: (req: {
        requestNumber: string
        moduleType: string
        decision: 'APPROVED' | 'REJECTED'
        approverName: string
        comment?: string
        decidedAt: string
        webUrl: string
    }) => {
        const isApproved = req.decision === 'APPROVED'
        const statusBg = isApproved ? '#DCFCE7' : '#FEE2E2'
        const statusColor = isApproved ? '#15803D' : '#B91C1C'
        const statusText = isApproved ? 'อนุมัติเรียบร้อย' : 'คำขอถูกปฏิเสธ'
        const statusIcon = isApproved ? '✅' : '❌'

        const timeStr = new Date(req.decidedAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })
        const dateStr = new Date(req.decidedAt).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })

        return {
            type: 'flex',
            altText: `${statusIcon} ${statusText}: ${req.requestNumber}`,
            contents: {
                type: 'bubble',
                size: 'mega',
                body: {
                    type: 'box',
                    layout: 'vertical',
                    paddingAll: '20px',
                    spacing: 'md',
                    contents: [
                        {
                            type: 'box',
                            layout: 'horizontal',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            contents: [
                                {
                                    type: 'text',
                                    text: req.requestNumber,
                                    size: 'xs',
                                    color: '#94A3B8',
                                    weight: 'bold',
                                },
                                {
                                    type: 'box',
                                    layout: 'horizontal',
                                    backgroundColor: statusBg,
                                    cornerRadius: 'xxl',
                                    paddingStart: '10px',
                                    paddingEnd: '10px',
                                    paddingTop: '4px',
                                    paddingBottom: '4px',
                                    contents: [
                                        {
                                            type: 'text',
                                            text: `${statusIcon} ${statusText}`,
                                            size: 'xxs',
                                            weight: 'bold',
                                            color: statusColor,
                                        }
                                    ]
                                }
                            ]
                        },
                        {
                            type: 'text',
                            text: isApproved ? 'คำขอของคุณได้รับการอนุมัติแล้ว' : 'คำขอของคุณไม่ผ่านการอนุมัติ',
                            size: 'lg',
                            weight: 'bold',
                            color: isApproved ? '#0F172A' : '#991B1B',
                            margin: 'md',
                        },
                        {
                            type: 'box',
                            layout: 'vertical',
                            backgroundColor: '#F8FAFC',
                            cornerRadius: '16px',
                            paddingAll: '14px',
                            spacing: 'sm',
                            margin: 'md',
                            contents: [
                                {
                                    type: 'box',
                                    layout: 'horizontal',
                                    justifyContent: 'space-between',
                                    contents: [
                                        { type: 'text', text: 'ผู้ตัดสินใจ', size: 'xs', color: '#64748B', flex: 1 },
                                        { type: 'text', text: req.approverName, size: 'xs', color: '#0F172A', weight: 'bold', align: 'end', flex: 2 }
                                    ]
                                },
                                ...(req.comment ? [
                                    {
                                        type: 'box' as const,
                                        layout: 'horizontal' as const,
                                        justifyContent: 'space-between' as const,
                                        contents: [
                                            { type: 'text' as const, text: 'เหตุผล', size: 'xs' as const, color: '#64748B' as const, flex: 1 },
                                            { type: 'text' as const, text: req.comment, size: 'xs' as const, color: '#0F172A' as const, align: 'end' as const, flex: 2, wrap: true as const }
                                        ]
                                    }
                                ] : []),
                                {
                                    type: 'box',
                                    layout: 'horizontal',
                                    justifyContent: 'space-between',
                                    contents: [
                                        { type: 'text', text: 'เวลา', size: 'xs', color: '#64748B', flex: 1 },
                                        { type: 'text', text: `${dateStr} ${timeStr}`, size: 'xs', color: '#0F172A', align: 'end', flex: 2 }
                                    ]
                                }
                            ]
                        },
                        {
                            type: 'box',
                            layout: 'vertical',
                            margin: 'lg',
                            contents: [
                                {
                                    type: 'button',
                                    style: 'secondary',
                                    height: 'md',
                                    action: {
                                        type: 'uri',
                                        label: '📄 ดูรายละเอียดในระบบ',
                                        uri: `${req.webUrl}/approvals`,
                                    }
                                }
                            ]
                        }
                    ]
                }
            }
        }
    },

    // ─── Samsung One UI 9 Style: สรุปปิดกะ → LINE ส่วนตัวของ Admin ─────────────
    // สีจาก Phopy Design System (indigo/mango/sand/ink) · แบบร่างที่เจ้าของเลือก: Desktop/pos-shift-line-mockup.html
    shiftCloseCard: (s: {
        shiftNumber: string; shopName: string; openedAt: string; closedAt: string; closedByName: string
        billCount: number; totalRevenue: number; cashRevenue: number; bankRevenue: number
        expectedCash: number; countedCash: number; difference: number
        topSales: { name: string; qty: number; amount: number }[]
        buys: { total: number; top: { label: string; sub: string; amount: number }[] }
        alerts: { voids: number; itemVoids: number; discountTotal: number }
        deliveryDiscounts?: { tag: string; count: number; discountAmount: number; salesAmount: number }[]
        webUrl: string
    }) => {
        const C = {
            indigo: '#3949E5', indigo50: '#EEF0FE', mango: '#F5A524', mango600: '#D9881A', mango50: '#FEF4E2',
            ink900: '#1E1B16', ink500: '#6B6658', sand100: '#F5F0E2', sand200: '#ECE6D8',
            danger: '#DC2626', danger50: '#FEE2E2', success: '#16A34A', success50: '#DCFCE7',
        }
        const baht = (n: number) => `฿${(Number(n) || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 })}`
        const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' })
        const diff = s.difference
        const drawer = diff < 0 ? { bg: C.danger50, pill: C.danger, text: `🔴 ขาด ${baht(-diff)}` }
            : diff > 0 ? { bg: C.mango50, pill: C.mango600, text: `🟠 เกิน ${baht(diff)}` }
            : { bg: C.success50, pill: C.success, text: '🟢 ตรงพอดี' }
        const pad = (all: string) => ({ paddingAll: all })

        const rankList = (rows: { title: string; sub: string; amount: number }[], tint: string, bar: string, max: number) =>
            rows.map((r, i) => ({
                type: 'box', layout: 'horizontal', spacing: 'md', alignItems: 'center', margin: 'sm',
                contents: [
                    { type: 'box', layout: 'vertical', width: '22px', height: '22px', cornerRadius: '8px', backgroundColor: tint,
                      justifyContent: 'center', contents: [{ type: 'text', text: String(i + 1), size: 'xxs', weight: 'bold', color: bar, align: 'center' }] },
                    { type: 'box', layout: 'vertical', flex: 1, contents: [
                        { type: 'text', text: r.title, size: 'sm', weight: 'bold', color: C.ink900, wrap: false },
                        { type: 'text', text: r.sub, size: 'xxs', color: C.ink500 },
                        { type: 'box', layout: 'vertical', height: '4px', backgroundColor: C.sand100, cornerRadius: '4px', margin: 'xs', contents: [
                            { type: 'box', layout: 'vertical', height: '4px', cornerRadius: '4px', backgroundColor: bar,
                              width: `${Math.max(4, Math.round((r.amount / (max || 1)) * 100))}%`, contents: [] },
                        ] },
                    ] },
                    { type: 'text', text: baht(r.amount), size: 'sm', weight: 'bold', color: C.ink900, flex: 0 },
                ],
            }))

        const section = (title: string, right: string, rows: any[], empty: string) => ({
            type: 'box', layout: 'vertical', margin: 'xl', contents: [
                { type: 'box', layout: 'horizontal', contents: [
                    { type: 'text', text: title, size: 'sm', weight: 'bold', color: C.ink900, flex: 1 },
                    { type: 'text', text: right, size: 'xxs', color: C.ink500, align: 'end', gravity: 'bottom', flex: 0 },
                ] },
                ...(rows.length ? rows : [{ type: 'text', text: empty, size: 'xs', color: C.ink500, margin: 'sm' }]),
            ],
        })

        const sales = s.topSales.map(t => ({ title: t.name, sub: `× ${t.qty.toLocaleString('th-TH')}`, amount: t.amount }))
        const buys = s.buys.top.map(b => ({ title: b.label, sub: b.sub, amount: b.amount }))
        const chips = [
            s.alerts.voids ? `🔴 ยกเลิกบิล ${s.alerts.voids}` : '',
            s.alerts.itemVoids ? `🟠 ลบรายการหลังส่งครัว ${s.alerts.itemVoids}` : '',
            s.alerts.discountTotal ? `🏷️ ส่วนลด ${baht(s.alerts.discountTotal)}` : '',
        ].filter(Boolean)
        const pillBtn = (label: string, uri: string, primary: boolean) => ({
            type: 'box', layout: 'vertical', cornerRadius: 'xxl', paddingTop: '11px', paddingBottom: '11px',
            backgroundColor: primary ? C.indigo : C.sand100, action: { type: 'uri', label, uri },
            contents: [{ type: 'text', text: label, size: 'sm', weight: 'bold', align: 'center', color: primary ? '#FFFFFF' : C.indigo }],
        })

const deliveryRows = (s.deliveryDiscounts || []).map(d => ({
            type: 'box', layout: 'horizontal', spacing: 'md', alignItems: 'center', margin: 'sm',
            contents: [
                { type: 'box', layout: 'vertical', width: '22px', height: '22px', cornerRadius: '8px', backgroundColor: C.mango50,
                  justifyContent: 'center', contents: [{ type: 'text', text: '🛵', size: 'xxs', align: 'center' }] },
                { type: 'box', layout: 'vertical', flex: 1, contents: [
                    { type: 'text', text: `${d.tag} (${d.count} บิล)`, size: 'sm', weight: 'bold', color: C.ink900, wrap: false },
                    { type: 'text', text: `ส่วนลด ฿${Number(d.discountAmount).toLocaleString('th-TH')}`, size: 'xxs', color: C.mango600 },
                ] },
                { type: 'text', text: baht(d.salesAmount), size: 'sm', weight: 'bold', color: C.ink900, flex: 0 },
            ],
        }))

        const deliveryText = s.deliveryDiscounts?.length
            ? ` · 🛵 ${s.deliveryDiscounts.map(d => `${d.tag}(${d.count})`).join(' ')}`
            : ''
        return {
            type: 'flex',
            altText: (`🔒 ปิดกะ ${s.shiftNumber}${s.shopName ? ` · ${s.shopName}` : ''} · ขาย ${baht(s.totalRevenue)} (${s.billCount} บิล)${deliveryText} · ส่วนลดรวม ${baht(s.alerts.discountTotal)} · ${drawer.text}`).slice(0, 400),
            contents: {
                type: 'bubble', size: 'mega',
                header: {
                    type: 'box', layout: 'vertical', backgroundColor: C.indigo, ...pad('18px'), spacing: 'xs',
                    contents: [
                        { type: 'text', text: '🔒 ปิดกะแล้ว', size: 'xxs', weight: 'bold', color: '#DDE1FD' },
                        { type: 'text', text: s.shiftNumber, size: 'lg', weight: 'bold', color: '#FFFFFF' },
                        { type: 'text', text: [s.shopName, `${hhmm(s.openedAt)} – ${hhmm(s.closedAt)}`, s.closedByName && `ปิดโดย ${s.closedByName}`].filter(Boolean).join(' · '),
                          size: 'xxs', color: '#DDE1FD', wrap: true },
                    ],
                },
                body: {
                    type: 'box', layout: 'vertical', ...pad('16px'),
                    contents: [
                        { type: 'box', layout: 'vertical', backgroundColor: C.indigo50, cornerRadius: '20px', ...pad('14px'), contents: [
                            { type: 'text', text: 'ยอดขายรวมกะนี้', size: 'xxs', color: C.ink500, weight: 'bold' },
                            { type: 'box', layout: 'baseline', spacing: 'sm', contents: [
                                { type: 'text', text: baht(s.totalRevenue), size: 'xxl', weight: 'bold', color: C.ink900, flex: 0 },
                                { type: 'text', text: `· ${s.billCount} บิล`, size: 'xs', color: C.ink500 },
                            ] },
                            { type: 'box', layout: 'horizontal', spacing: 'sm', margin: 'md', contents: [
                                { type: 'box', layout: 'vertical', backgroundColor: '#FFFFFF', cornerRadius: '14px', ...pad('8px'), contents: [
                                    { type: 'text', text: '💵 เงินสด', size: 'xxs', color: C.ink500 },
                                    { type: 'text', text: baht(s.cashRevenue), size: 'md', weight: 'bold', color: C.ink900 },
                                ] },
                                { type: 'box', layout: 'vertical', backgroundColor: '#FFFFFF', cornerRadius: '14px', ...pad('8px'), contents: [
                                    { type: 'text', text: '📱 โอน / QR', size: 'xxs', color: C.ink500 },
                                    { type: 'text', text: baht(s.bankRevenue), size: 'md', weight: 'bold', color: C.ink900 },
                                ] },
                            ] },
                            { type: 'box', layout: 'horizontal', backgroundColor: '#FFFFFF', cornerRadius: '14px', ...pad('8px'), margin: 'sm', alignItems: 'center', contents: [
                                { type: 'text', text: '🏷️ ส่วนลดรวมทั้งกะ', size: 'xs', color: C.ink500, flex: 1 },
                                { type: 'text', text: baht(s.alerts.discountTotal), size: 'sm', weight: 'bold', color: s.alerts.discountTotal > 0 ? C.mango600 : C.ink900, flex: 0 },
                            ] },
                        ] },
                        { type: 'box', layout: 'vertical', backgroundColor: drawer.bg, cornerRadius: '18px', ...pad('12px'), margin: 'md', contents: [
                            { type: 'text', text: '💰 เงินในลิ้นชัก · ควรมี → นับได้', size: 'xxs', color: C.ink500, weight: 'bold' },
                            { type: 'box', layout: 'horizontal', alignItems: 'center', margin: 'xs', contents: [
                                { type: 'text', text: `${baht(s.expectedCash)} → ${baht(s.countedCash)}`, size: 'md', weight: 'bold', color: C.ink900, flex: 1 },
                                { type: 'box', layout: 'vertical', flex: 0, backgroundColor: drawer.pill, cornerRadius: 'xxl',
                                  paddingStart: '10px', paddingEnd: '10px', paddingTop: '4px', paddingBottom: '4px',
                                  contents: [{ type: 'text', text: drawer.text, size: 'xs', weight: 'bold', color: '#FFFFFF' }] },
                            ] },
                        ] },
                        section('🍽️ ขายดีสุด 5 อันดับ', 'ตามยอดเงิน', rankList(sales, C.indigo50, C.indigo, sales[0]?.amount || 0), 'ไม่มีบิลที่ชำระในกะนี้'),
                        ...(deliveryRows.length ? [
                            section('🛵 ยอด Delivery / ส่วนลด > 20%', `รวม ${s.deliveryDiscounts!.reduce((t, d) => t + d.count, 0)} บิล`, deliveryRows, '')
                        ] : []),
                        section('🛒 ซื้อสูงสุด 5 อันดับ', `รวม ${baht(s.buys.total)}`, rankList(buys, C.mango50, C.mango, buys[0]?.amount || 0), 'ไม่มีการซื้อหรือจ่ายออกในกะนี้'),
                        ...(chips.length ? [{ type: 'box', layout: 'vertical', margin: 'xl', spacing: 'xs', contents: chips.map(c => ({
                            type: 'box', layout: 'horizontal', contents: [{ type: 'box', layout: 'vertical', flex: 0, backgroundColor: C.sand100, cornerRadius: 'xxl',
                                paddingStart: '10px', paddingEnd: '10px', paddingTop: '4px', paddingBottom: '4px',
                                contents: [{ type: 'text', text: c, size: 'xxs', weight: 'bold', color: C.ink900 }] }],
                        })) }] : []),
                    ],
                },
                footer: {
                    type: 'box', layout: 'vertical', spacing: 'sm', paddingStart: '16px', paddingEnd: '16px', paddingBottom: '16px', paddingTop: '4px',
                    contents: [
                        pillBtn('ดูรายการขายวันนี้', `${s.webUrl}/accounting/pos-clearing`, true),
                        pillBtn('ดูบันทึกความเคลื่อนไหว', `${s.webUrl}/approvals`, false),
                    ],
                },
            },
        }
    },

};
