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

  initialize: () => Promise<void>
  generateKeys: () => Promise<void>
  decryptMessage: (message: {
    encrypted_content?: string | null
    ephemeral_public_key?: string | null
  }) => Promise<string>
  clearKeys: () => Promise<void>
}

export const useEncryptionStore = create<EncryptionState>((set, get) => ({
  isInitialized: false,
  hasKeys: false,
  currentKeyId: null,
  identityKeyPair: null,

  initialize: async () => {
    console.log('[Encryption] Starting initialization...')
    try {
      const hasKeys = await keyStorageService.hasStoredKeys()
      console.log('[Encryption] hasStoredKeys:', hasKeys)

      if (hasKeys) {
        try {
          console.log('[Encryption] Loading keys from IndexedDB...')
          const keyPair = await keyStorageService.loadKeys()
          const currentKeyId = await keyStorageService.getCurrentKeyId()
          console.log('[Encryption] Keys loaded, keyId:', currentKeyId)

          set({
            isInitialized: true,
            hasKeys: true,
            identityKeyPair: keyPair,
            currentKeyId,
          })
          console.log('[Encryption] Initialized successfully from IndexedDB')
        } catch (loadError) {
          console.warn('[Encryption] Failed to load keys, clearing and regenerating...', loadError)
          await keyStorageService.clearKeys()
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

      await keyStorageService.storeKeys(keyPair)
      console.log('[Encryption] Keys stored in IndexedDB')

      const { data: registeredKey } = await keysApi.register({
        public_key: uint8ArrayToBase64(keyPair.publicKey),
        signature_public_key: uint8ArrayToBase64(keyPair.publicKey),
        key_type: 'identity',
      })
      console.log('[Encryption] Keys registered on server, id:', registeredKey.id)

      await keyStorageService.setCurrentKeyId(registeredKey.id)

      set({
        isInitialized: true,
        hasKeys: true,
        identityKeyPair: keyPair,
        currentKeyId: registeredKey.id,
      })
      console.log('[Encryption] Keys generated and initialized successfully')
    } catch (error) {
      console.error('[Encryption] Failed to generate keys:', error)
      throw error
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

  clearKeys: async () => {
    set({
      isInitialized: false,
      hasKeys: false,
      currentKeyId: null,
      identityKeyPair: null,
    })
  },
}))
