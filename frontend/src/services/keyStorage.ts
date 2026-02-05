import { get, set, del } from 'idb-keyval'
import { IdentityKeyPair, uint8ArrayToBase64, base64ToUint8Array } from './crypto'

// Storage keys
const KEYS_STORED_FLAG = 'encryption_keys_stored'
const PUBLIC_KEY = 'encryption_public_key'
const SECRET_KEY = 'encryption_secret_key'
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
   * Store identity keys in IndexedDB (no password encryption for auto-init on page load)
   */
  async storeKeys(keyPair: IdentityKeyPair): Promise<void> {
    await set(PUBLIC_KEY, uint8ArrayToBase64(keyPair.publicKey))
    await set(SECRET_KEY, uint8ArrayToBase64(keyPair.secretKey))
    await set(KEYS_STORED_FLAG, true)
  }

  /**
   * Load identity keys from IndexedDB
   */
  async loadKeys(): Promise<IdentityKeyPair> {
    const publicKeyB64 = await get(PUBLIC_KEY)
    const secretKeyB64 = await get(SECRET_KEY)

    if (!publicKeyB64 || !secretKeyB64) {
      throw new Error('No stored keys found')
    }

    return {
      publicKey: base64ToUint8Array(publicKeyB64),
      secretKey: base64ToUint8Array(secretKeyB64),
    }
  }

  /**
   * Clear all stored keys
   */
  async clearKeys(): Promise<void> {
    await del(PUBLIC_KEY)
    await del(SECRET_KEY)
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
