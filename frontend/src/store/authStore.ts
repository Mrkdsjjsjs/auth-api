import { create } from 'zustand'
import { authApi } from '../services/api'
import wsService from '../services/websocket'
import { useEncryptionStore } from './encryptionStore'
import { keyStorageService } from '../services/keyStorage'

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
  logout: () => Promise<void>
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

      wsService.connect(data.access_token)

      const { data: user } = await authApi.me()
      set({ user, isAuthenticated: true, isLoading: false })

      // Initialize encryption
      const encryptionStore = useEncryptionStore.getState()
      const hasKeys = await keyStorageService.hasStoredKeys()

      if (hasKeys) {
        await encryptionStore.initialize()
      } else {
        await encryptionStore.generateKeys()
      }
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
      const { data } = await authApi.login(email, password)
      localStorage.setItem('access_token', data.access_token)
      localStorage.setItem('refresh_token', data.refresh_token)

      wsService.connect(data.access_token)

      const { data: user } = await authApi.me()
      set({ user, isAuthenticated: true, isLoading: false })

      // Generate new encryption keys
      const encryptionStore = useEncryptionStore.getState()
      await encryptionStore.generateKeys()
    } catch (error: any) {
      set({
        error: error.response?.data?.detail || 'Registration failed',
        isLoading: false,
      })
      throw error
    }
  },

  logout: async () => {
    try {
      await authApi.logout()
    } catch {
      // Ignore errors
    }

    localStorage.removeItem('access_token')
    localStorage.removeItem('refresh_token')
    wsService.disconnect()

    const encryptionStore = useEncryptionStore.getState()
    await encryptionStore.clearKeys()

    set({ user: null, isAuthenticated: false })
  },

  loadUser: async () => {
    set({ isLoading: true })
    try {
      const { data: user } = await authApi.me()
      const token = localStorage.getItem('access_token')
      if (token) {
        wsService.connect(token)
      }
      set({ user, isAuthenticated: true, isLoading: false })

      // Auto-initialize encryption from IndexedDB
      const encryptionStore = useEncryptionStore.getState()
      await encryptionStore.initialize()
    } catch {
      localStorage.removeItem('access_token')
      localStorage.removeItem('refresh_token')
      set({ user: null, isAuthenticated: false, isLoading: false })
    }
  },
}))
