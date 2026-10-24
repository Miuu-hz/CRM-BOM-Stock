import api from './api'

// Ticket-based types
export interface KDSTicketItem {
    id: string
    ticket_id: string
    bill_item_id: string
    product_name: string
    quantity: number
    special_instructions: string | null
    status: 'PENDING' | 'DONE' | 'CANCELLED'
    /** จำนวนที่ถูกยกเลิกหลังส่งครัว (เทียบกับ quantity ตอนส่ง) */
    void_qty?: number
    void_reason?: string | null
}

export interface KDSTicket {
    id: string
    tenant_id: string
    bill_id: string
    bill_number: string
    table_name: string
    round: number
    status: 'PENDING' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED'
    sent_at: string
    updated_at: string
    items: KDSTicketItem[]
}

const kdsService = {
    // ==================== Notification helpers ====================

    requestNotificationPermission: async (): Promise<NotificationPermission> => {
        if (!('Notification' in window)) return 'denied'
        if (Notification.permission !== 'default') return Notification.permission
        return Notification.requestPermission()
    },

    notifyNewTickets: (newCount: number): void => {
        if (Notification.permission === 'granted') {
            new Notification('KDS · ออร์เดอร์ใหม่', {
                body: `มี ${newCount} ออร์เดอร์ใหม่รอดำเนินการในครัว`,
                icon: '/favicon.ico',
                tag: 'kds-alert',
            })
        }
        if ('vibrate' in navigator) {
            navigator.vibrate([200, 100, 200, 100, 200])
        }
    },

    // ==================== Ticket-based ====================

    sendToKitchen: async (billId: string): Promise<{ ticket_id: string; round: number; item_count: number }> => {
        const response = await api.post('/pos/kds/send', { bill_id: billId })
        return response.data.data
    },

    getTickets: async (): Promise<KDSTicket[]> => {
        const response = await api.get('/pos/kds/tickets')
        return response.data.data
    },

    updateTicketStatus: async (ticketId: string, status: 'IN_PROGRESS' | 'DONE' | 'CANCEL_ACK'): Promise<any> => {
        const response = await api.patch(`/pos/kds/tickets/${ticketId}/status`, { status })
        return response.data
    },

    // ติ๊ก/เอาติ๊กออก "ทำเสร็จแล้ว" รายเมนู — ใช้ได้หลังกดรับงาน
    setItemDone: async (ticketId: string, itemId: string, done: boolean): Promise<any> => {
        const response = await api.patch(`/pos/kds/tickets/${ticketId}/items/${itemId}`, { done })
        return response.data
    }
}

export default kdsService
