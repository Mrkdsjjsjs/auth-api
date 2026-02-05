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
  initialize: (password: string) => Promise<void>
  generateKeys: (password: string) => Promise<void>
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
   */
  initialize: async (password: string) => {
    try {
      const hasKeys = await keyStorageService.hasStoredKeys()

      if (hasKeys) {
        // Load keys from IndexedDB
        const keyPair = await keyStorageService.loadKeys(password)
        const currentKeyId = await keyStorageService.getCurrentKeyId()

        set({
          isInitialized: true,
          hasKeys: true,
          identityKeyPair: keyPair,
          currentKeyId,
        })
        console.log('Encryption initialized with stored keys')
      } else {
        // Try to restore from server backup
        try {
          const { data: backup } = await keysApi.getBackup()
          const keyPair = await keyStorageService.restoreFromBackup(
            backup.encrypted_blob,
            backup.salt,
            password
          )

          // Get current key ID from server
          const { data: serverKeys } = await keysApi.getMyKeys()
          const identityKey = serverKeys.find((k: any) => k.key_type === 'identity' && k.is_active)

          if (identityKey) {
            await keyStorageService.setCurrentKeyId(identityKey.id)
          }

          set({
            isInitialized: true,
            hasKeys: true,
            identityKeyPair: keyPair,
            currentKeyId: identityKey?.id || null,
          })
          console.log('Encryption initialized from server backup')
        } catch {
          // No backup available, need to generate new keys
          console.log('No keys found, will generate new ones')
          set({ isInitialized: false, hasKeys: false })
        }
      }
    } catch (error) {
      console.error('Failed to initialize encryption:', error)
      throw error
    }
  },

  /**
   * Generate new identity keys (on first login or when keys are lost)
   */
  generateKeys: async (password: string) => {
    try {
      // Generate new key pair
      const keyPair = cryptoService.generateIdentityKeyPair()

      // Store locally in IndexedDB (encrypted with password)
      const { encryptedBlob, salt } = await keyStorageService.storeKeys(keyPair, password)

      // Register public key with server
      // Note: server expects both encryption and signature keys, but we only have one
      // So we use the same key for both (simplified)
      const { data: registeredKey } = await keysApi.register({
        public_key: uint8ArrayToBase64(keyPair.publicKey),
        signature_public_key: uint8ArrayToBase64(keyPair.publicKey), // Same key for simplicity
        key_type: 'identity',
      })

      await keyStorageService.setCurrentKeyId(registeredKey.id)

      // Save backup to server (for recovery on other devices)
      await keysApi.saveBackup({
        encrypted_blob: encryptedBlob,
        salt: salt,
      })

      set({
        isInitialized: true,
        hasKeys: true,
        identityKeyPair: keyPair,
        currentKeyId: registeredKey.id,
      })

      console.log('New encryption keys generated and stored')
    } catch (error) {
      console.error('Failed to generate keys:', error)
      throw error
    }
  },

  /**
   * Decrypt a message encrypted by the server
   * Server uses NaCl Box with ephemeral key
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

    // Decrypt using NaCl box.open
    return cryptoService.decryptFromServer(
      ciphertext,
      nonce,
      ephemeralPublicKey,
      identityKeyPair.secretKey
    )
  },

  /**
   * Clear all encryption state (on logout)
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
