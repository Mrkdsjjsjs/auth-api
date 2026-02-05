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
  encryption_enabled?: boolean
}

interface AuthState {
  user: User | null
  isAuthenticated: boolean
  isLoading: boolean
  error: string | null
  currentPassword: string | null  // Temporarily stored for encryption init
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  loadUser: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,  // Will be set by loadUser
  isLoading: true,  // Start loading until we check auth
  error: null,
  currentPassword: null,

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
      set({ user, isAuthenticated: true, isLoading: false, currentPassword: password })

      // Initialize E2E encryption
      const encryptionStore = useEncryptionStore.getState()
      const hasKeys = await keyStorageService.hasStoredKeys()

      if (hasKeys) {
        // Load existing keys
        try {
          await encryptionStore.initialize(password)
        } catch (error) {
          console.warn('Failed to initialize encryption with stored keys:', error)
          // Keys might be corrupted or password changed, generate new ones
          await encryptionStore.generateKeys(password)
        }
      } else {
        // Generate new keys for this user
        await encryptionStore.generateKeys(password)
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
      // Auto-login after register
      const { data } = await authApi.login(email, password)
      localStorage.setItem('access_token', data.access_token)
      localStorage.setItem('refresh_token', data.refresh_token)

      wsService.connect(data.access_token)

      const { data: user } = await authApi.me()
      set({ user, isAuthenticated: true, isLoading: false, currentPassword: password })

      // Generate new encryption keys for the new user
      const encryptionStore = useEncryptionStore.getState()
      await encryptionStore.generateKeys(password)
    } catch (error: any) {
      set({
        error: error.response?.data?.detail || 'Registration failed',
        isLoading: false,
      })
      throw error
    }
  },

  logout: async () => {
    // Call API to clear cookies
    try {
      await authApi.logout()
    } catch {
      // Ignore errors, still clear local state
    }

    localStorage.removeItem('access_token')
    localStorage.removeItem('refresh_token')
    wsService.disconnect()

    // Don't clear keys from IndexedDB - user might log back in
    set({ user: null, isAuthenticated: false, currentPassword: null })
  },

  loadUser: async () => {
    // Try to load user - cookies will be sent automatically
    // Also check localStorage for WebSocket token
    set({ isLoading: true })
    try {
      const { data: user } = await authApi.me()
      const token = localStorage.getItem('access_token')
      if (token) {
        wsService.connect(token)
      }
      set({ user, isAuthenticated: true, isLoading: false })

      // Note: Encryption won't be fully initialized until user provides password again
      // This is intentional for security - we don't store the password
      // They'll need to decrypt messages manually or re-login
    } catch {
      localStorage.removeItem('access_token')
      localStorage.removeItem('refresh_token')
      set({ user: null, isAuthenticated: false, isLoading: false })
    }
  },
}))
