import axios from 'axios'

const API_URL = import.meta.env.VITE_API_URL || ''

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true,  // Send cookies with requests
})

// Add token to requests (from localStorage as backup, cookies are sent automatically)
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('access_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  // Cookies with credentials: true are sent automatically
  return config
})

// Handle token refresh
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config

    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true

      const refreshToken = localStorage.getItem('refresh_token')
      if (refreshToken) {
        try {
          const { data } = await axios.post(`${API_URL}/auth/refresh`, {
            refresh_token: refreshToken,
          })

          localStorage.setItem('access_token', data.access_token)
          localStorage.setItem('refresh_token', data.refresh_token)

          // Rotate encryption keys on token refresh
          try {
            // Dynamically import to avoid circular dependency
            const { useEncryptionStore } = await import('../store/encryptionStore')
            const { useAuthStore } = await import('../store/authStore')
            const encryptionStore = useEncryptionStore.getState()
            const authStore = useAuthStore.getState()

            if (encryptionStore.isInitialized && authStore.currentPassword) {
              await encryptionStore.rotateKeys(authStore.currentPassword)
            }
          } catch (rotateError) {
            console.warn('Key rotation on refresh failed:', rotateError)
            // Continue anyway - key rotation failure shouldn't block the request
          }

          originalRequest.headers.Authorization = `Bearer ${data.access_token}`
          return api(originalRequest)
        } catch {
          localStorage.removeItem('access_token')
          localStorage.removeItem('refresh_token')
          window.location.href = '/login'
        }
      }
    }

    return Promise.reject(error)
  }
)

// Auth
export const authApi = {
  login: (email: string, password: string) =>
    api.post('/auth/login', { email, password }),

  register: (email: string, password: string) =>
    api.post('/auth/register', { email, password }),

  logout: () => api.post('/auth/logout'),

  me: () => api.get('/auth/me'),
}

// Users
export const usersApi = {
  search: (q: string) => api.get(`/api/users/search?q=${q}`),
  getById: (id: string) => api.get(`/api/users/${id}`),
  updateProfile: (data: { username?: string; display_name?: string; bio?: string }) =>
    api.put('/api/users/me', data),
}

// Chats
export const chatsApi = {
  list: () => api.get('/api/chats'),
  create: (type: string, memberIds: string[], name?: string) =>
    api.post('/api/chats', { type, member_ids: memberIds, name }),
  get: (id: string) => api.get(`/api/chats/${id}`),
}

// Messages
export const messagesApi = {
  list: (chatId: string, before?: string) =>
    api.get(`/api/chats/${chatId}/messages${before ? `?before=${before}` : ''}`),
  send: (chatId: string, content: string, replyToId?: string, encryption?: {
    encrypted_content: string
    encryption_version: number
    sender_key_id: string
    ephemeral_public_key?: string
  }) =>
    api.post(`/api/chats/${chatId}/messages`, {
      content: encryption ? null : content,
      reply_to_id: replyToId,
      ...(encryption || {}),
    }),
  edit: (messageId: string, content: string) =>
    api.put(`/api/messages/${messageId}`, { content }),
  delete: (messageId: string) => api.delete(`/api/messages/${messageId}`),
  markRead: (messageId: string) => api.post(`/api/messages/${messageId}/read`),
}

// Encryption Keys
export const keysApi = {
  register: (data: { public_key: string; signature_public_key: string; key_type: string }) =>
    api.post('/api/keys/register', data),
  getUserKey: (userId: string, keyType: string = 'identity') =>
    api.get(`/api/keys/user/${userId}?key_type=${keyType}`),
  getMyKeys: () => api.get('/api/keys/me'),
  rotate: (data: { new_public_key: string; new_signature_public_key: string; signature: string }) =>
    api.post('/api/keys/rotate', data),
  saveBackup: (data: { encrypted_blob: string; salt: string }) =>
    api.post('/api/keys/backup', data),
  getBackup: () => api.get('/api/keys/backup'),
  getChatKey: (chatId: string) => api.get(`/api/keys/chat/${chatId}`),
  setChatKeys: (chatId: string, data: { encrypted_keys: Array<{ user_id: string; encrypted_key: string; user_key_id: string }> }) =>
    api.post(`/api/keys/chat/${chatId}`, data),
  rotateChatKey: (chatId: string, data: { encrypted_keys: Array<{ user_id: string; encrypted_key: string; user_key_id: string }> }) =>
    api.post(`/api/keys/chat/${chatId}/rotate`, data),
}

export default api
