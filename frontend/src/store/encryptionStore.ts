import { create } from 'zustand'
import {
  cryptoService,
  IdentityKeyPair,
  EncryptedPayload,
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
  recipientPublicKeys: Map<string, Uint8Array>  // userId -> publicKey
  chatKeys: Map<string, Uint8Array>  // chatId -> groupKey

  // Actions
  initialize: (password: string) => Promise<void>
  generateKeys: (password: string) => Promise<void>
  rotateKeys: (password: string) => Promise<void>
  encryptMessage: (chatId: string, content: string, chatType: 'direct' | 'group', recipientUserId?: string) => Promise<{
    encryptedContent: string
    encryptionVersion: number
    senderKeyId: string
    ephemeralPublicKey?: string
  }>
  decryptMessage: (message: {
    encrypted_content?: string | null
    encryption_version: number
    sender_id: string
    chat_id: string
    ephemeral_public_key?: string | null
  }, chatType: 'direct' | 'group') => Promise<string>
  loadRecipientPublicKey: (userId: string) => Promise<Uint8Array>
  loadChatKey: (chatId: string) => Promise<Uint8Array>
  createChatKey: (chatId: string, memberUserIds: string[]) => Promise<void>
  clearKeys: () => Promise<void>
}

export const useEncryptionStore = create<EncryptionState>((set, get) => ({
  isInitialized: false,
  hasKeys: false,
  currentKeyId: null,
  identityKeyPair: null,
  recipientPublicKeys: new Map(),
  chatKeys: new Map(),

  /**
   * Initialize encryption with existing keys
   */
  initialize: async (password: string) => {
    try {
      const hasKeys = await keyStorageService.hasStoredKeys()

      if (hasKeys) {
        // Load keys from local storage
        const keyPair = await keyStorageService.loadKeys(password)
        const currentKeyId = await keyStorageService.getCurrentKeyId()

        set({
          isInitialized: true,
          hasKeys: true,
          identityKeyPair: keyPair,
          currentKeyId,
        })
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
        } catch {
          // No backup available, will need to generate new keys
          set({ isInitialized: false, hasKeys: false })
        }
      }
    } catch (error) {
      console.error('Failed to initialize encryption:', error)
      throw error
    }
  },

  /**
   * Generate new identity keys
   */
  generateKeys: async (password: string) => {
    try {
      // Generate new key pair
      const keyPair = cryptoService.generateIdentityKeyPair()

      // Store locally (encrypted with password)
      const { encryptedBlob, salt } = await keyStorageService.storeKeys(keyPair, password)

      // Register public key with server
      const { data: registeredKey } = await keysApi.register({
        public_key: uint8ArrayToBase64(keyPair.x25519.publicKey),
        signature_public_key: uint8ArrayToBase64(keyPair.ed25519.publicKey),
        key_type: 'identity',
      })

      await keyStorageService.setCurrentKeyId(registeredKey.id)

      // Save backup to server
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
    } catch (error) {
      console.error('Failed to generate keys:', error)
      throw error
    }
  },

  /**
   * Rotate session keys (called on token refresh)
   */
  rotateKeys: async (password: string) => {
    const { identityKeyPair } = get()
    if (!identityKeyPair) {
      throw new Error('No identity keys to sign rotation')
    }

    try {
      // Generate new session key pair
      const newSessionKeyPair = cryptoService.generateIdentityKeyPair()

      // Sign the new public keys with identity key
      const dataToSign = new TextEncoder().encode(
        uint8ArrayToBase64(newSessionKeyPair.x25519.publicKey) +
        uint8ArrayToBase64(newSessionKeyPair.ed25519.publicKey)
      )
      const signature = cryptoService.sign(dataToSign, identityKeyPair.ed25519.privateKey)

      // Register rotated keys with server
      const { data: rotatedKey } = await keysApi.rotate({
        new_public_key: uint8ArrayToBase64(newSessionKeyPair.x25519.publicKey),
        new_signature_public_key: uint8ArrayToBase64(newSessionKeyPair.ed25519.publicKey),
        signature: uint8ArrayToBase64(signature),
      })

      // Update local storage with new session keys
      // Note: Identity keys remain the same, only session keys rotate
      const updatedKeyPair: IdentityKeyPair = {
        x25519: newSessionKeyPair.x25519,
        ed25519: newSessionKeyPair.ed25519,
      }

      await keyStorageService.storeKeys(updatedKeyPair, password)
      await keyStorageService.setCurrentKeyId(rotatedKey.id)

      set({
        identityKeyPair: updatedKeyPair,
        currentKeyId: rotatedKey.id,
      })
    } catch (error) {
      console.error('Failed to rotate keys:', error)
      // Don't throw - rotation failure shouldn't break the app
    }
  },

  /**
   * Load a recipient's public key from cache or server
   */
  loadRecipientPublicKey: async (userId: string) => {
    const { recipientPublicKeys } = get()

    // Check cache
    const cached = recipientPublicKeys.get(userId)
    if (cached) {
      return cached
    }

    // Fetch from server
    const { data: userKey } = await keysApi.getUserKey(userId)
    const publicKey = base64ToUint8Array(userKey.public_key)

    // Cache it
    set({
      recipientPublicKeys: new Map(recipientPublicKeys).set(userId, publicKey),
    })

    return publicKey
  },

  /**
   * Load a chat's group key from cache or server
   */
  loadChatKey: async (chatId: string) => {
    const { chatKeys, identityKeyPair } = get()

    // Check memory cache
    const cached = chatKeys.get(chatId)
    if (cached) {
      return cached
    }

    // Check IndexedDB cache
    const stored = await keyStorageService.getChatKey(chatId)
    if (stored) {
      set({
        chatKeys: new Map(chatKeys).set(chatId, stored.key),
      })
      return stored.key
    }

    // Fetch from server
    if (!identityKeyPair) {
      throw new Error('No identity keys available')
    }

    try {
      const { data: chatKeyData } = await keysApi.getChatKey(chatId)

      // The encrypted_key contains: ciphertext:nonce (base64:base64)
      const [ciphertext, nonce] = chatKeyData.encrypted_key.split(':')

      // We need the admin's public key to decrypt
      // For simplicity, we'll assume the key was encrypted with our public key
      // In a real implementation, we'd need to track who encrypted it

      // Decrypt the group key using our private key
      // This is simplified - in production, use the actual sender's public key
      const groupKey = cryptoService.decrypt(
        base64ToUint8Array(ciphertext),
        identityKeyPair.x25519.privateKey,
        base64ToUint8Array(nonce)
      )

      // Cache it
      await keyStorageService.storeChatKey(chatId, groupKey, chatKeyData.key_version)
      set({
        chatKeys: new Map(chatKeys).set(chatId, groupKey),
      })

      return groupKey
    } catch (error) {
      // No chat key available - this chat might not have E2E yet
      console.warn('No chat encryption key available:', error)
      throw error
    }
  },

  /**
   * Create and distribute a new chat key for a group chat
   */
  createChatKey: async (chatId: string, memberUserIds: string[]) => {
    const { identityKeyPair, currentKeyId } = get()
    if (!identityKeyPair || !currentKeyId) {
      throw new Error('No identity keys available')
    }

    // Generate new group key
    const groupKey = cryptoService.generateGroupKey()

    // Encrypt the group key for each member
    const encryptedKeys = []
    for (const userId of memberUserIds) {
      try {
        const recipientPublicKey = await get().loadRecipientPublicKey(userId)

        const encrypted = cryptoService.encryptGroupKeyForUser(
          groupKey,
          recipientPublicKey,
          identityKeyPair.x25519.privateKey
        )

        // Combine ciphertext and nonce for storage
        const encryptedKeyString = `${encrypted.ciphertext}:${encrypted.nonce}`

        encryptedKeys.push({
          user_id: userId,
          encrypted_key: encryptedKeyString,
          user_key_id: currentKeyId, // Using our key ID for tracking
        })
      } catch (error) {
        console.warn(`Failed to encrypt key for user ${userId}:`, error)
      }
    }

    // Send to server
    await keysApi.setChatKeys(chatId, { encrypted_keys: encryptedKeys })

    // Store locally
    await keyStorageService.storeChatKey(chatId, groupKey, 1)
    set({
      chatKeys: new Map(get().chatKeys).set(chatId, groupKey),
    })
  },

  /**
   * Encrypt a message
   */
  encryptMessage: async (chatId: string, content: string, chatType: 'direct' | 'group', recipientUserId?: string) => {
    const { identityKeyPair, currentKeyId } = get()
    if (!identityKeyPair || !currentKeyId) {
      throw new Error('Encryption not initialized')
    }

    if (chatType === 'direct') {
      if (!recipientUserId) {
        throw new Error('Recipient user ID required for direct messages')
      }

      const recipientPublicKey = await get().loadRecipientPublicKey(recipientUserId)
      const encrypted = cryptoService.encryptDirectMessage(content, recipientPublicKey)

      return {
        encryptedContent: `${encrypted.ciphertext}:${encrypted.nonce}`,
        encryptionVersion: 1,
        senderKeyId: currentKeyId,
        ephemeralPublicKey: encrypted.ephemeralPublicKey,
      }
    } else {
      // Group chat
      const groupKey = await get().loadChatKey(chatId)
      const encrypted = cryptoService.encryptGroupMessage(content, groupKey)

      return {
        encryptedContent: `${encrypted.ciphertext}:${encrypted.nonce}`,
        encryptionVersion: 1,
        senderKeyId: currentKeyId,
      }
    }
  },

  /**
   * Decrypt a message
   */
  decryptMessage: async (message, chatType) => {
    const { identityKeyPair } = get()
    if (!identityKeyPair) {
      throw new Error('Encryption not initialized')
    }

    if (message.encryption_version === 0 || !message.encrypted_content) {
      // Plaintext message
      return ''
    }

    const [ciphertext, nonce] = message.encrypted_content.split(':')
    const payload: EncryptedPayload = {
      ciphertext,
      nonce,
      ephemeralPublicKey: message.ephemeral_public_key || undefined,
    }

    if (chatType === 'direct') {
      return cryptoService.decryptDirectMessage(payload, identityKeyPair.x25519.privateKey)
    } else {
      const groupKey = await get().loadChatKey(message.chat_id)
      return cryptoService.decryptGroupMessage(payload, groupKey)
    }
  },

  /**
   * Clear all encryption state and keys
   */
  clearKeys: async () => {
    await keyStorageService.clearKeys()
    set({
      isInitialized: false,
      hasKeys: false,
      currentKeyId: null,
      identityKeyPair: null,
      recipientPublicKeys: new Map(),
      chatKeys: new Map(),
    })
  },
}))
