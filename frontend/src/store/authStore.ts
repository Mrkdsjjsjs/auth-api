import { create } from 'zustand'
import { authApi } from '../services/api'
import wsService from '../services/websocket'

interface User {
  id: string
  email: string
  username?: string
  display_name?: string
  avatar_url?: string
  is_online?: boolean
}

interface AuthState {
  user: User | null
  isAuthenticated: boolean
  isLoading: boolean
  error: string | null
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string) => Promise<void>
  logout: () => void
  loadUser: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: !!localStorage.getItem('access_token'),
  isLoading: false,
  error: null,

  login: async (email, password) => {
    set({ isLoading: true, error: null })
    try {
      const { data } = await authApi.login(email, password)
      localStorage.setItem('access_token', data.access_token)
      localStorage.setItem('refresh_token', data.refresh_token)

      // Connect WebSocket
      wsService.connect(data.access_token)

      // Load user
      const { data: user } = await authApi.me()
      set({ user, isAuthenticated: true, isLoading: false })
    } catch (error: any) {
      set({
        error: error.response?.data?.detail || 'Login failed',
        isLoading: false,
      })
      throw error
    }
  },

  register: async (email, password) => {
    set({ isLoading: true, error: null })
    try {
      await authApi.register(email, password)
      // Auto-login after register
      const { data } = await authApi.login(email, password)
      localStorage.setItem('access_token', data.access_token)
      localStorage.setItem('refresh_token', data.refresh_token)

      wsService.connect(data.access_token)

      const { data: user } = await authApi.me()
      set({ user, isAuthenticated: true, isLoading: false })
    } catch (error: any) {
      set({
        error: error.response?.data?.detail || 'Registration failed',
        isLoading: false,
      })
      throw error
    }
  },

  logout: () => {
    localStorage.removeItem('access_token')
    localStorage.removeItem('refresh_token')
    wsService.disconnect()
    set({ user: null, isAuthenticated: false })
  },

  loadUser: async () => {
    const token = localStorage.getItem('access_token')
    if (!token) return

    try {
      const { data: user } = await authApi.me()
      wsService.connect(token)
      set({ user, isAuthenticated: true })
    } catch {
      localStorage.removeItem('access_token')
      localStorage.removeItem('refresh_token')
      set({ user: null, isAuthenticated: false })
    }
  },
}))
