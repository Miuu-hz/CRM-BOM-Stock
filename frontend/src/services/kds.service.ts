import api from './api'

// Legacy types
export interface KDSItem {
    id: string
    pos_menu_id: string
    product_name: string
    image_url: string | null
    quantity: number
    special_instructions: string | null
    status: 'PENDING' | 'PREPARING' | 'READY' | 'SERVED'
    added_at: string
}

export interface KDSOrder {
    bill_id: string
    bill_number: string
    bill_name: string
    opened_at: string
    items: KDSItem[]
}

// Ticket-based types
export interface KDSTicketItem {
    id: string
    ticket_id: string
    bill_item_id: string
    product_name: string
    quantity: number
    special_instructions: string | null
    status: 'PENDING' | 'DONE'
}

export interface KDSTicket {
    id: string
    tenant_id: string
    bill_id: string
    bill_number: string
    table_name: string
    round: number
    status: 'PENDING' | 'IN_PROGRESS' | 'DONE'
    sent_at: string
    updated_at: string
    items: KDSTicketItem[]
}

const kdsService = {
    // ==================== Ticket-based (new) ====================

    sendToKitchen: async (billId: string): Promise<{ ticket_id: string; round: number; item_count: number }> => {
        const response = await api.post('/pos/kds/send', { bill_id: billId })
        return response.data.data
    },

    getTickets: async (): Promise<KDSTicket[]> => {
        const response = await api.get('/pos/kds/tickets')
        return response.data.data
    },

    updateTicketStatus: async (ticketId: string, status: 'IN_PROGRESS' | 'DONE'): Promise<any> => {
        const response = await api.patch(`/pos/kds/tickets/${ticketId}/status`, { status })
        return response.data
    },

    // ==================== Legacy (backward compat) ====================

    getOrders: async (): Promise<KDSOrder[]> => {
        const response = await api.get('/pos/kds/orders')
        return response.data.data
    },

    updateItemStatus: async (itemId: string, status: 'PREPARING' | 'READY'): Promise<any> => {
        const response = await api.patch(`/pos/kds/items/${itemId}/status`, { status })
        return response.data
    }
}

export default kdsService
