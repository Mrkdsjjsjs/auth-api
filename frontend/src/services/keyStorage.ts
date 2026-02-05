import { get, set, del, keys } from 'idb-keyval'
import { IdentityKeyPair, cryptoService } from './crypto'

// Storage keys
const KEYS_STORED_FLAG = 'encryption_keys_stored'
const ENCRYPTED_KEYS_BLOB = 'encrypted_keys_blob'
const ENCRYPTED_KEYS_SALT = 'encrypted_keys_salt'
const CURRENT_KEY_ID = 'current_key_id'

// Group key storage prefix
const CHAT_KEY_PREFIX = 'chat_key_'

export interface StoredChatKey {
  key: Uint8Array
  version: number
  createdAt: number
}

export class KeyStorageService {
  /**
   * Check if user has stored encryption keys
   */
  async hasStoredKeys(): Promise<boolean> {
    const flag = await get(KEYS_STORED_FLAG)
    return flag === true
  }

  /**
   * Store encrypted identity keys in IndexedDB
   * Keys are encrypted with password-derived key before storage
   */
  async storeKeys(keyPair: IdentityKeyPair, password: string): Promise<{ encryptedBlob: string; salt: string }> {
    const { encryptedBlob, salt } = cryptoService.encryptKeyPairForStorage(keyPair, password)

    await set(ENCRYPTED_KEYS_BLOB, encryptedBlob)
    await set(ENCRYPTED_KEYS_SALT, salt)
    await set(KEYS_STORED_FLAG, true)

    return { encryptedBlob, salt }
  }

  /**
   * Load and decrypt identity keys from IndexedDB
   */
  async loadKeys(password: string): Promise<IdentityKeyPair> {
    const encryptedBlob = await get(ENCRYPTED_KEYS_BLOB)
    const salt = await get(ENCRYPTED_KEYS_SALT)

    if (!encryptedBlob || !salt) {
      throw new Error('No stored keys found')
    }

    return cryptoService.decryptKeyPairFromStorage(encryptedBlob, salt, password)
  }

  /**
   * Get the encrypted blob and salt for server backup
   */
  async getEncryptedBackup(): Promise<{ encryptedBlob: string; salt: string } | null> {
    const encryptedBlob = await get(ENCRYPTED_KEYS_BLOB)
    const salt = await get(ENCRYPTED_KEYS_SALT)

    if (!encryptedBlob || !salt) {
      return null
    }

    return { encryptedBlob, salt }
  }

  /**
   * Restore keys from server backup
   */
  async restoreFromBackup(encryptedBlob: string, salt: string, password: string): Promise<IdentityKeyPair> {
    // First verify we can decrypt them
    const keyPair = cryptoService.decryptKeyPairFromStorage(encryptedBlob, salt, password)

    // Store locally
    await set(ENCRYPTED_KEYS_BLOB, encryptedBlob)
    await set(ENCRYPTED_KEYS_SALT, salt)
    await set(KEYS_STORED_FLAG, true)

    return keyPair
  }

  /**
   * Clear all stored keys
   */
  async clearKeys(): Promise<void> {
    await del(ENCRYPTED_KEYS_BLOB)
    await del(ENCRYPTED_KEYS_SALT)
    await del(KEYS_STORED_FLAG)
    await del(CURRENT_KEY_ID)

    // Clear all chat keys
    const allKeys = await keys()
    for (const key of allKeys) {
      if (typeof key === 'string' && key.startsWith(CHAT_KEY_PREFIX)) {
        await del(key)
      }
    }
  }

  /**
   * Store current key ID (from server)
   */
  async setCurrentKeyId(keyId: string): Promise<void> {
    await set(CURRENT_KEY_ID, keyId)
  }

  /**
   * Get current key ID
   */
  async getCurrentKeyId(): Promise<string | null> {
    return (await get(CURRENT_KEY_ID)) || null
  }

  /**
   * Store a chat's group key
   */
  async storeChatKey(chatId: string, key: Uint8Array, version: number): Promise<void> {
    const storedKey: StoredChatKey = {
      key: Array.from(key) as any, // Store as array for JSON compatibility
      version,
      createdAt: Date.now(),
    }
    await set(`${CHAT_KEY_PREFIX}${chatId}`, storedKey)
  }

  /**
   * Get a chat's group key
   */
  async getChatKey(chatId: string): Promise<StoredChatKey | null> {
    const stored = await get(`${CHAT_KEY_PREFIX}${chatId}`)
    if (!stored) {
      return null
    }

    return {
      key: new Uint8Array(stored.key),
      version: stored.version,
      createdAt: stored.createdAt,
    }
  }

  /**
   * Delete a chat's group key
   */
  async deleteChatKey(chatId: string): Promise<void> {
    await del(`${CHAT_KEY_PREFIX}${chatId}`)
  }

  /**
   * Check if we have a group key for a chat
   */
  async hasChatKey(chatId: string): Promise<boolean> {
    const key = await get(`${CHAT_KEY_PREFIX}${chatId}`)
    return key !== undefined
  }
}

// Export singleton instance
export const keyStorageService = new KeyStorageService()
