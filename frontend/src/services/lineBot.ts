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

export const generateLinkToken = async () => {
    const { data } = await api.post('/line/link-token')
    return data
}

export const getLinkStatus = async () => {
    const { data } = await api.get('/line/link-status')
    return data
}

export const unlinkLine = async () => {
    const { data } = await api.delete('/line/link')
    return data
}

export const getLinkedUsers = async () => {
    const { data } = await api.get('/line/linked-users')
    return data
}

export const unlinkUserLine = async (userId: string) => {
    const { data } = await api.delete(`/line/link/${userId}`)
    return data
}
