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

    // 3. Status Summary Card
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
    }
};
