import axios from 'axios'

const API_URL = import.meta.env.VITE_API_URL || ''

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true,  // Send cookies with requests
})

// Add token to requests
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('access_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
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

// Messages - E2E encrypted
export const messagesApi = {
  list: (chatId: string, before?: string) =>
    api.get(`/api/chats/${chatId}/messages${before ? `?before=${before}` : ''}`),
  send: (chatId: string, content: string, replyToId?: string) =>
    api.post(`/api/chats/${chatId}/messages`, {
      content,
      reply_to_id: replyToId,
    }),
  sendE2E: (chatId: string, plaintextFallback: string, encryption: {
    encrypted_for_recipient: { encrypted_content: string; ephemeral_public_key: string } | null
    encrypted_for_sender: { encrypted_content: string; ephemeral_public_key: string } | null
    recipient_user_id: string | undefined
    encrypted_file_id?: string
    message_type?: string
  }) =>
    api.post(`/api/chats/${chatId}/messages`, {
      // Send plaintext as fallback only if encryption failed
      content: encryption.encrypted_for_recipient ? null : plaintextFallback,
      encrypted_for_recipient: encryption.encrypted_for_recipient,
      encrypted_for_sender: encryption.encrypted_for_sender,
      recipient_user_id: encryption.recipient_user_id,
      encrypted_file_id: encryption.encrypted_file_id,
      message_type: encryption.message_type || 'text',
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
  saveBackup: (data: { encrypted_blob: string; salt: string }) =>
    api.post('/api/keys/backup', data),
  getBackup: () => api.get('/api/keys/backup'),
  // Exchange keys with server for E2E transport
  exchangeKeys: (clientPublicKey: string) =>
    api.post('/api/keys/exchange', { client_public_key: clientPublicKey }),
}

// Encrypted Files - E2E encrypted file storage
export const encryptedFilesApi = {
  upload: (data: {
    encrypted_data: string
    original_filename: string
    content_type: string
    file_nonce: string
    key_for_recipient: {
      encrypted_key: string
      key_nonce: string
      ephemeral_public_key: string
    }
    key_for_sender: {
      encrypted_key: string
      key_nonce: string
      ephemeral_public_key: string
    }
    recipient_user_id: string
    chat_id: string
  }) => api.post('/api/encrypted-files/upload', data),

  getInfo: (fileId: string) => api.get(`/api/encrypted-files/${fileId}`),

  download: (fileId: string) =>
    api.get(`/api/encrypted-files/${fileId}/download`, { responseType: 'arraybuffer' }),
}

export default api
