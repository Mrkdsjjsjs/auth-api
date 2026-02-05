import { get, set, del } from 'idb-keyval'
import { IdentityKeyPair, cryptoService } from './crypto'

// Storage keys
const KEYS_STORED_FLAG = 'encryption_keys_stored'
const ENCRYPTED_KEYS_BLOB = 'encrypted_keys_blob'
const ENCRYPTED_KEYS_SALT = 'encrypted_keys_salt'
const CURRENT_KEY_ID = 'current_key_id'

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
}

// Export singleton instance
export const keyStorageService = new KeyStorageService()
