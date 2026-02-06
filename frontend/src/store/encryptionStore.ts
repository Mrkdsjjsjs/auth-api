import { create } from 'zustand'
import {
  cryptoService,
  IdentityKeyPair,
  uint8ArrayToBase64,
  base64ToUint8Array,
} from '../services/crypto'
import { keyStorageService } from '../services/keyStorage'
import { keysApi } from '../services/api'

interface EncryptionState {
  isInitialized: boolean
  hasKeys: boolean
  currentKeyId: string | null
  identityKeyPair: IdentityKeyPair | null
  serverPublicKey: string | null  // Server's public key for E2E transport
  recipientKeysCache: Map<string, string>  // Cache for recipient public keys (for files)

  initialize: () => Promise<void>
  generateKeys: () => Promise<void>
  decryptMessage: (message: {
    encrypted_content?: string | null
    ephemeral_public_key?: string | null
  }) => Promise<string>
  encryptForServer: (plaintext: string) => Promise<{
    encrypted_content: string
    ephemeral_public_key: string
  } | null>
  getRecipientPublicKey: (userId: string) => Promise<string | null>
  clearKeys: () => void
}

export const useEncryptionStore = create<EncryptionState>((set, get) => ({
  isInitialized: false,
  hasKeys: false,
  currentKeyId: null,
  identityKeyPair: null,
  serverPublicKey: null,
  recipientKeysCache: new Map(),

  initialize: async () => {
    console.log('[Encryption] Starting initialization...')
    try {
      const hasKeys = keyStorageService.hasStoredKeys()
      console.log('[Encryption] hasStoredKeys:', hasKeys)

      if (hasKeys) {
        try {
          console.log('[Encryption] Loading keys from localStorage...')
          const keyPair = keyStorageService.loadKeys()
          const currentKeyId = keyStorageService.getCurrentKeyId()
          const serverPublicKey = keyStorageService.getServerPublicKey()
          console.log('[Encryption] Keys loaded, keyId:', currentKeyId)

          set({
            isInitialized: true,
            hasKeys: true,
            identityKeyPair: keyPair,
            currentKeyId,
            serverPublicKey,
          })

          // If no server public key, exchange keys now
          if (!serverPublicKey && keyPair) {
            console.log('[Encryption] No server key, initiating exchange...')
            await exchangeKeysWithServer(keyPair)
          }

          console.log('[Encryption] SUCCESS - Initialized from localStorage')
        } catch (loadError) {
          console.warn('[Encryption] Failed to load keys, regenerating...', loadError)
          keyStorageService.clearKeys()
          await get().generateKeys()
        }
      } else {
        console.log('[Encryption] No keys found, generating new ones...')
        await get().generateKeys()
      }
    } catch (error) {
      console.error('[Encryption] Initialize failed:', error)
      set({ isInitialized: false, hasKeys: false })
    }
  },

  generateKeys: async () => {
    console.log('[Encryption] Generating new keys...')
    try {
      const keyPair = cryptoService.generateIdentityKeyPair()
      console.log('[Encryption] Key pair generated')

      keyStorageService.storeKeys(keyPair)
      console.log('[Encryption] Keys stored')

      const { data: registeredKey } = await keysApi.register({
        public_key: uint8ArrayToBase64(keyPair.publicKey),
        signature_public_key: uint8ArrayToBase64(keyPair.publicKey),
        key_type: 'identity',
      })
      console.log('[Encryption] Registered on server, id:', registeredKey.id)

      keyStorageService.setCurrentKeyId(registeredKey.id)

      // Exchange keys with server
      await exchangeKeysWithServer(keyPair)

      set({
        isInitialized: true,
        hasKeys: true,
        identityKeyPair: keyPair,
        currentKeyId: registeredKey.id,
      })
      console.log('[Encryption] SUCCESS - Keys generated')
    } catch (error) {
      console.error('[Encryption] Failed to generate keys:', error)
      // Don't throw - just log and leave uninitialized
      set({ isInitialized: false, hasKeys: false })
    }
  },

  decryptMessage: async (message) => {
    const { identityKeyPair } = get()

    if (!identityKeyPair) {
      throw new Error('Encryption not initialized')
    }

    if (!message.encrypted_content || !message.ephemeral_public_key) {
      throw new Error('Missing encryption data')
    }

    const [ciphertextB64, nonceB64] = message.encrypted_content.split(':')
    const ciphertext = base64ToUint8Array(ciphertextB64)
    const nonce = base64ToUint8Array(nonceB64)
    const ephemeralPublicKey = base64ToUint8Array(message.ephemeral_public_key)

    return cryptoService.decryptFromServer(
      ciphertext,
      nonce,
      ephemeralPublicKey,
      identityKeyPair.secretKey
    )
  },

  encryptForServer: async (plaintext: string) => {
    const { identityKeyPair, serverPublicKey } = get()

    if (!identityKeyPair) {
      console.warn('[Encryption] No identity key pair')
      return null
    }

    if (!serverPublicKey) {
      console.warn('[Encryption] No server public key, trying to exchange...')
      await exchangeKeysWithServer(identityKeyPair)
      const newServerKey = get().serverPublicKey
      if (!newServerKey) {
        console.error('[Encryption] Failed to get server public key')
        return null
      }
    }

    const currentServerKey = get().serverPublicKey
    if (!currentServerKey) {
      return null
    }

    try {
      const serverPublicKeyBytes = base64ToUint8Array(currentServerKey)
      const encrypted = cryptoService.encryptForRecipient(
        plaintext,
        serverPublicKeyBytes
      )

      return {
        encrypted_content: `${encrypted.ciphertext}:${encrypted.nonce}`,
        ephemeral_public_key: encrypted.ephemeralPublicKey,
      }
    } catch (error) {
      console.error('[Encryption] Failed to encrypt for server:', error)
      return null
    }
  },

  getRecipientPublicKey: async (userId: string) => {
    const { recipientKeysCache } = get()

    // Check cache first
    if (recipientKeysCache.has(userId)) {
      return recipientKeysCache.get(userId)!
    }

    try {
      const { data } = await keysApi.getUserKey(userId)
      if (data.public_key) {
        recipientKeysCache.set(userId, data.public_key)
        return data.public_key
      }
    } catch (error) {
      console.warn('[Encryption] Failed to get recipient public key:', error)
    }
    return null
  },

  clearKeys: () => {
    keyStorageService.clearKeys()
    set({
      isInitialized: false,
      hasKeys: false,
      currentKeyId: null,
      identityKeyPair: null,
      serverPublicKey: null,
      recipientKeysCache: new Map(),
    })
  },
}))

// Helper function to exchange keys with server
async function exchangeKeysWithServer(keyPair: IdentityKeyPair) {
  try {
    const { data } = await keysApi.exchangeKeys(uint8ArrayToBase64(keyPair.publicKey))
    const serverPublicKey = data.server_public_key
    console.log('[Encryption] Got server public key')

    keyStorageService.setServerPublicKey(serverPublicKey)
    useEncryptionStore.setState({ serverPublicKey })
  } catch (error) {
    console.error('[Encryption] Failed to exchange keys with server:', error)
  }
}
