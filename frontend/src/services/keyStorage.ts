import { IdentityKeyPair, uint8ArrayToBase64, base64ToUint8Array } from './crypto'

const KEYS_STORED_FLAG = 'encryption_keys_stored'
const PUBLIC_KEY = 'encryption_public_key'
const SECRET_KEY = 'encryption_secret_key'
const CURRENT_KEY_ID = 'encryption_current_key_id'

export class KeyStorageService {
  hasStoredKeys(): boolean {
    const flag = localStorage.getItem(KEYS_STORED_FLAG)
    console.log('[KeyStorage] hasStoredKeys:', flag)
    return flag === 'true'
  }

  storeKeys(keyPair: IdentityKeyPair): void {
    console.log('[KeyStorage] Storing keys...')
    const pubKey = uint8ArrayToBase64(keyPair.publicKey)
    const secKey = uint8ArrayToBase64(keyPair.secretKey)

    localStorage.setItem(PUBLIC_KEY, pubKey)
    localStorage.setItem(SECRET_KEY, secKey)
    localStorage.setItem(KEYS_STORED_FLAG, 'true')
    console.log('[KeyStorage] Keys stored in localStorage')
  }

  loadKeys(): IdentityKeyPair {
    console.log('[KeyStorage] Loading keys...')
    const publicKeyB64 = localStorage.getItem(PUBLIC_KEY)
    const secretKeyB64 = localStorage.getItem(SECRET_KEY)

    console.log('[KeyStorage] publicKey exists:', !!publicKeyB64)
    console.log('[KeyStorage] secretKey exists:', !!secretKeyB64)

    if (!publicKeyB64 || !secretKeyB64) {
      throw new Error('No stored keys found')
    }

    return {
      publicKey: base64ToUint8Array(publicKeyB64),
      secretKey: base64ToUint8Array(secretKeyB64),
    }
  }

  clearKeys(): void {
    console.log('[KeyStorage] Clearing keys...')
    localStorage.removeItem(PUBLIC_KEY)
    localStorage.removeItem(SECRET_KEY)
    localStorage.removeItem(KEYS_STORED_FLAG)
    localStorage.removeItem(CURRENT_KEY_ID)
  }

  setCurrentKeyId(keyId: string): void {
    localStorage.setItem(CURRENT_KEY_ID, keyId)
  }

  getCurrentKeyId(): string | null {
    return localStorage.getItem(CURRENT_KEY_ID)
  }
}

export const keyStorageService = new KeyStorageService()
