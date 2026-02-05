import { get, set, del } from 'idb-keyval'
import { IdentityKeyPair, uint8ArrayToBase64, base64ToUint8Array } from './crypto'

const KEYS_STORED_FLAG = 'encryption_keys_stored'
const PUBLIC_KEY = 'encryption_public_key'
const SECRET_KEY = 'encryption_secret_key'
const CURRENT_KEY_ID = 'current_key_id'

export class KeyStorageService {
  async hasStoredKeys(): Promise<boolean> {
    const flag = await get(KEYS_STORED_FLAG)
    console.log('[KeyStorage] hasStoredKeys flag:', flag)
    return flag === true
  }

  async storeKeys(keyPair: IdentityKeyPair): Promise<void> {
    console.log('[KeyStorage] Storing keys...')
    const pubKey = uint8ArrayToBase64(keyPair.publicKey)
    const secKey = uint8ArrayToBase64(keyPair.secretKey)
    console.log('[KeyStorage] Public key (first 20 chars):', pubKey.substring(0, 20))

    await set(PUBLIC_KEY, pubKey)
    await set(SECRET_KEY, secKey)
    await set(KEYS_STORED_FLAG, true)
    console.log('[KeyStorage] Keys stored successfully')
  }

  async loadKeys(): Promise<IdentityKeyPair> {
    console.log('[KeyStorage] Loading keys...')
    const publicKeyB64 = await get(PUBLIC_KEY)
    const secretKeyB64 = await get(SECRET_KEY)

    console.log('[KeyStorage] publicKeyB64:', publicKeyB64 ? 'exists' : 'null')
    console.log('[KeyStorage] secretKeyB64:', secretKeyB64 ? 'exists' : 'null')

    if (!publicKeyB64 || !secretKeyB64) {
      throw new Error('No stored keys found - missing PUBLIC_KEY or SECRET_KEY')
    }

    return {
      publicKey: base64ToUint8Array(publicKeyB64),
      secretKey: base64ToUint8Array(secretKeyB64),
    }
  }

  async clearKeys(): Promise<void> {
    console.log('[KeyStorage] Clearing all keys...')
    await del(PUBLIC_KEY)
    await del(SECRET_KEY)
    await del(KEYS_STORED_FLAG)
    await del(CURRENT_KEY_ID)
    console.log('[KeyStorage] Keys cleared')
  }

  async setCurrentKeyId(keyId: string): Promise<void> {
    await set(CURRENT_KEY_ID, keyId)
  }

  async getCurrentKeyId(): Promise<string | null> {
    return (await get(CURRENT_KEY_ID)) || null
  }
}

export const keyStorageService = new KeyStorageService()
