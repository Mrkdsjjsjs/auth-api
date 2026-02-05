import axios from 'axios'

const API_URL = import.meta.env.VITE_API_URL || ''

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
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
  send: (chatId: string, content: string, replyToId?: string) =>
    api.post(`/api/chats/${chatId}/messages`, { content, reply_to_id: replyToId }),
  edit: (messageId: string, content: string) =>
    api.put(`/api/messages/${messageId}`, { content }),
  delete: (messageId: string) => api.delete(`/api/messages/${messageId}`),
  markRead: (messageId: string) => api.post(`/api/messages/${messageId}/read`),
}

export default api
