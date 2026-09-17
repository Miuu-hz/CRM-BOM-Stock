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
                            type: 'postback',
                            label: 'เริ่มผลิต',
                            data: `action=start_wo&id=${wo.id}`,
                            displayText: `เริ่มผลิต ${wo.wo_number}`
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
                    type: 'postback',
                    label: 'ผลิตเสร็จ',
                    data: `action=complete_wo&id=${wo.id}`,
                    displayText: `ผลิตเสร็จ ${wo.wo_number}`
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
    welcomeCard: () => ({
        type: 'flex',
        altText: 'ยินดีต้อนรับสู่ระบบ CRM-BOM-Stock',
        contents: {
            type: 'bubble',
            header: {
                type: 'box', layout: 'vertical',
                backgroundColor: '#0066cc',
                contents: [{ type: 'text', text: '👋 ยินดีต้อนรับ!', weight: 'bold', color: '#ffffff', size: 'xl' }]
            },
            body: {
                type: 'box', layout: 'vertical', spacing: 'md',
                contents: [
                    { type: 'text', text: 'เชื่อมบัญชีเพื่อใช้งานเต็มรูปแบบ:', weight: 'bold', size: 'sm' },
                    { type: 'text', text: '1. เปิดระบบ → ตั้งค่า → LINE Bot', size: 'sm', color: '#666666' },
                    { type: 'text', text: '2. กด "สร้างรหัสเชื่อม" และได้รับรหัส 6 หลัก', size: 'sm', color: '#666666' },
                    { type: 'text', text: '3. ส่ง: /ลิงก์ [รหัส] มาในแชทนี้', size: 'sm', color: '#666666' },
                    { type: 'separator', margin: 'md' },
                    { type: 'text', text: 'พิมพ์ "ช่วยเหลือ" เพื่อดูคำสั่งทั้งหมด', size: 'sm', color: '#0066cc' },
                ]
            }
        }
    }),

    // 4. Help Card
    helpCard: (isPersonal: boolean) => ({
        type: 'flex',
        altText: 'คำสั่งที่ใช้ได้',
        contents: {
            type: 'bubble',
            header: {
                type: 'box', layout: 'vertical', backgroundColor: '#333333',
                contents: [{ type: 'text', text: '📖 คำสั่งที่ใช้ได้', weight: 'bold', color: '#ffffff' }]
            },
            body: {
                type: 'box', layout: 'vertical', spacing: 'sm',
                contents: [
                    { type: 'text', text: 'สถานะ', weight: 'bold', size: 'sm' },
                    { type: 'text', text: '→ ดูใบสั่งผลิตที่กำลังดำเนินการ', size: 'sm', color: '#666666', margin: 'xs' },
                    { type: 'separator', margin: 'md' },
                    { type: 'text', text: 'สต็อก [ชื่อสินค้า]', weight: 'bold', size: 'sm', margin: 'md' },
                    { type: 'text', text: '→ ค้นหาสินค้าในคลัง', size: 'sm', color: '#666666', margin: 'xs' },
                    { type: 'separator', margin: 'md' },
                    { type: 'text', text: 'ออเดอร์', weight: 'bold', size: 'sm', margin: 'md' },
                    { type: 'text', text: '→ ดูคำสั่งซื้อล่าสุด 5 รายการ', size: 'sm', color: '#666666', margin: 'xs' },
                    { type: 'separator', margin: 'md' },
                    { type: 'text', text: 'สูตร [ชื่อสินค้า]', weight: 'bold', size: 'sm', margin: 'md' },
                    { type: 'text', text: '→ ดูส่วนผสม + ต้นทุนการผลิต', size: 'sm', color: '#666666', margin: 'xs' },
                    ...(isPersonal ? [
                        { type: 'separator' as const, margin: 'md' as const },
                        { type: 'text' as const, text: 'ถาม-ตอบทั่วไป (AI)', weight: 'bold' as const, size: 'sm' as const, margin: 'md' as const },
                        { type: 'text' as const, text: '→ พิมพ์สอบถามหรือคุยกับระบบได้โดยตรง', size: 'sm' as const, color: '#666666', margin: 'xs' as const },
                        { type: 'separator' as const, margin: 'md' as const },
                        { type: 'text' as const, text: 'ลิงก์ [รหัส 6 หลัก]', weight: 'bold' as const, size: 'sm' as const, margin: 'md' as const },
                        { type: 'text' as const, text: '→ เชื่อมบัญชีเพื่อรับการแจ้งเตือนงานอนุมัติ', size: 'sm' as const, color: '#666666', margin: 'xs' as const },
                    ] : []),
                ]
            }
        }
    }),

    // 5. Stock Query Card
    stockQueryCard: (query: string, items: any[]) => {
        if (items.length === 0) {
            return { type: 'text', text: `ไม่พบสินค้าที่ชื่อมี "${query}" ในคลังสินค้าครับ` }
        }
        const rows = items.map(it => ({
            type: 'box', layout: 'horizontal', margin: 'sm',
            contents: [
                { type: 'text', text: it.name, size: 'sm', flex: 4, wrap: true },
                { type: 'text', text: `${it.quantity} ${it.unit}`, size: 'sm', flex: 2, align: 'end' as const,
                  color: it.quantity <= 0 ? '#cc0000' : it.status === 'LOW' ? '#ff9900' : '#00aa44' }
            ]
        }))
        return {
            type: 'flex', altText: `สต็อก: ${query}`,
            contents: {
                type: 'bubble',
                header: {
                    type: 'box', layout: 'vertical', backgroundColor: '#005599',
                    contents: [{ type: 'text', text: `📦 ค้นหา: ${query}`, weight: 'bold', color: '#ffffff', size: 'sm' }]
                },
                body: { type: 'box', layout: 'vertical', contents: rows }
            }
        }
    },

    // 6. Recent Orders Card
    recentOrdersCard: (orders: any[]) => {
        if (orders.length === 0) {
            return { type: 'text', text: 'ยังไม่มีคำสั่งซื้อในระบบครับ' }
        }
        const rows = orders.map(o => ({
            type: 'box', layout: 'horizontal', margin: 'sm',
            contents: [
                { type: 'text', text: o.order_number, size: 'sm', flex: 2, weight: 'bold' as const },
                { type: 'text', text: o.status, size: 'xs', flex: 2, color: '#888888' },
                { type: 'text', text: `฿${Number(o.total_amount).toLocaleString()}`, size: 'sm', flex: 2, align: 'end' as const }
            ]
        }))
        return {
            type: 'flex', altText: 'คำสั่งซื้อล่าสุด',
            contents: {
                type: 'bubble',
                header: {
                    type: 'box', layout: 'vertical', backgroundColor: '#444444',
                    contents: [{ type: 'text', text: '🛒 คำสั่งซื้อล่าสุด', weight: 'bold', color: '#ffffff', size: 'sm' }]
                },
                body: { type: 'box', layout: 'vertical', contents: rows }
            }
        }
    },

    // 7. Status Summary Card
    statusSummaryCard: (inProgress: any[]) => {
        if (inProgress.length === 0) {
            return {
                type: 'text',
                text: 'ตอนนี้ไม่มีรายการที่กำลังผลิตครับ ✨'
            };
        }

        const items = inProgress.slice(0, 5).map(wo => ({
            type: 'box',
            layout: 'horizontal',
            margin: 'md',
            contents: [
                { type: 'text', text: wo.wo_number, size: 'sm', color: '#555555', flex: 2, weight: 'bold' },
                { type: 'text', text: wo.product_name, size: 'sm', color: '#888888', flex: 3 }
            ]
        }));

        if (inProgress.length > 5) {
            items.push({
                type: 'box',
                layout: 'horizontal',
                margin: 'md',
                contents: [
                    { type: 'text', text: `... และอีก ${inProgress.length - 5} รายการ`, size: 'xs', color: '#aaaaaa', flex: 0 }
                ]
            });
        }

        return {
            type: 'flex',
            altText: 'สรุปสถานะการผลิต',
            contents: {
                type: 'bubble',
                header: {
                    type: 'box',
                    layout: 'vertical',
                    backgroundColor: '#333333',
                    contents: [
                        { type: 'text', text: '📊 รายการกำลังผลิต', weight: 'bold', color: '#ffffff' }
                    ]
                },
                body: {
                    type: 'box',
                    layout: 'vertical',
                    contents: items
                }
            }
        };
    },

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
        const moduleConfig: Record<string, { label: string; icon: string; bg: string; color: string }> = {
            stock_adjust:      { label: 'ปรับ/เปลี่ยนสต็อก',  icon: '📦', bg: '#EEF2FF', color: '#4F46E5' },
            pos_void:          { label: 'ยกเลิกบิล POS',     icon: '🧾', bg: '#FFF7ED', color: '#EA580C' },
            doc_edit:          { label: 'แก้ไขเอกสาร',       icon: '✏️', bg: '#FAF5FF', color: '#9333EA' },
            sales_order:       { label: 'คำสั่งขาย',         icon: '🛒', bg: '#ECFEFF', color: '#0891B2' },
            purchase_order:    { label: 'ใบสั่งซื้อ',         icon: '🛍️', bg: '#F0FDF4', color: '#16A34A' },
            purchase_request:  { label: 'ใบขอซื้อ',          icon: '📄', bg: '#FEF3C7', color: '#D97706' },
            work_orders:       { label: 'ใบสั่งผลิต',        icon: '🏭', bg: '#F1F5F9', color: '#475569' },
        }
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

};
