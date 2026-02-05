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

  // Actions
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

  /**
   * Initialize encryption with existing keys from IndexedDB
   * No password needed - keys are stored unencrypted
   */
  initialize: async () => {
    try {
      const hasKeys = await keyStorageService.hasStoredKeys()

      if (hasKeys) {
        const keyPair = await keyStorageService.loadKeys()
        const currentKeyId = await keyStorageService.getCurrentKeyId()

        set({
          isInitialized: true,
          hasKeys: true,
          identityKeyPair: keyPair,
          currentKeyId,
        })
        console.log('Encryption initialized from IndexedDB')
      } else {
        set({ isInitialized: false, hasKeys: false })
      }
    } catch (error) {
      console.error('Failed to initialize encryption:', error)
      set({ isInitialized: false, hasKeys: false })
    }
  },

  /**
   * Generate new identity keys (on first login)
   */
  generateKeys: async () => {
    try {
      // Generate new key pair
      const keyPair = cryptoService.generateIdentityKeyPair()

      // Store locally in IndexedDB
      await keyStorageService.storeKeys(keyPair)

      // Register public key with server
      const { data: registeredKey } = await keysApi.register({
        public_key: uint8ArrayToBase64(keyPair.publicKey),
        signature_public_key: uint8ArrayToBase64(keyPair.publicKey),
        key_type: 'identity',
      })

      await keyStorageService.setCurrentKeyId(registeredKey.id)

      set({
        isInitialized: true,
        hasKeys: true,
        identityKeyPair: keyPair,
        currentKeyId: registeredKey.id,
      })

      console.log('New encryption keys generated')
    } catch (error) {
      console.error('Failed to generate keys:', error)
      throw error
    }
  },

  /**
   * Decrypt a message encrypted by the server
   */
  decryptMessage: async (message) => {
    const { identityKeyPair } = get()

    if (!identityKeyPair) {
      throw new Error('Encryption not initialized')
    }

    if (!message.encrypted_content || !message.ephemeral_public_key) {
      throw new Error('Missing encryption data')
    }

    // Parse encrypted content: "ciphertext:nonce"
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

  /**
   * Clear encryption state (on logout)
   */
  clearKeys: async () => {
    // Don't clear IndexedDB - user might log back in
    set({
      isInitialized: false,
      hasKeys: false,
      currentKeyId: null,
      identityKeyPair: null,
    })
  },
}))
