import api from './api'

export interface LineConfig {
    id?: string
    channel_name: string
    channel_secret: string
    channel_access_token: string
    is_active: boolean
}

export const getLineConfig = async () => {
    const { data } = await api.get('/line/config')
    return data
}

export const updateLineConfig = async (config: Partial<LineConfig>) => {
    const { data } = await api.put('/line/config', config)
    return data
}

export const testLineMessage = async () => {
    const { data } = await api.post('/line/test')
    return data
}
