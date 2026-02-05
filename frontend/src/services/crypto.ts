import nacl from 'tweetnacl'
import { encodeBase64, decodeBase64, encodeUTF8, decodeUTF8 } from 'tweetnacl-util'

// Types
export interface IdentityKeyPair {
  publicKey: Uint8Array
  secretKey: Uint8Array
}

// Helper functions
export function uint8ArrayToBase64(bytes: Uint8Array): string {
  return encodeBase64(bytes)
}

export function base64ToUint8Array(base64: string): Uint8Array {
  return decodeBase64(base64)
}

export class CryptoService {
  /**
   * Generate a new key pair for NaCl Box (X25519)
   */
  generateIdentityKeyPair(): IdentityKeyPair {
    const keyPair = nacl.box.keyPair()
    return {
      publicKey: keyPair.publicKey,
      secretKey: keyPair.secretKey,
    }
  }

  /**
   * Derive encryption key from password using PBKDF2-like approach
   * Note: TweetNaCl doesn't have PBKDF2, so we use scrypt-like hashing
   */
  deriveKeyFromPassword(password: string, salt: Uint8Array): Uint8Array {
    // Simple key derivation: hash(password + salt) multiple times
    const passwordBytes = decodeUTF8(password)
    const combined = new Uint8Array(passwordBytes.length + salt.length)
    combined.set(passwordBytes)
    combined.set(salt, passwordBytes.length)

    let key = nacl.hash(combined).slice(0, 32)
    // Stretch the key
    for (let i = 0; i < 10000; i++) {
      key = nacl.hash(key).slice(0, 32)
    }
    return key
  }

  /**
   * Generate a random salt
   */
  generateSalt(): Uint8Array {
    return nacl.randomBytes(16)
  }

  /**
   * Decrypt a message from the server
   * Server uses NaCl Box with ephemeral key pair
   */
  decryptFromServer(
    ciphertext: Uint8Array,
    nonce: Uint8Array,
    ephemeralPublicKey: Uint8Array,
    recipientSecretKey: Uint8Array
  ): string {
    const decrypted = nacl.box.open(ciphertext, nonce, ephemeralPublicKey, recipientSecretKey)
    if (!decrypted) {
      throw new Error('Decryption failed')
    }
    return encodeUTF8(decrypted)
  }

  /**
   * Compute shared secret (for direct box operations if needed)
   */
  computeSharedSecret(secretKey: Uint8Array, publicKey: Uint8Array): Uint8Array {
    return nacl.box.before(publicKey, secretKey)
  }

  /**
   * Encrypt the key pair for storage (protected by password)
   */
  encryptKeyPairForStorage(
    keyPair: IdentityKeyPair,
    password: string
  ): { encryptedBlob: string; salt: string } {
    const salt = this.generateSalt()
    const derivedKey = this.deriveKeyFromPassword(password, salt)

    // Serialize the key pair
    const keyBundle = JSON.stringify({
      publicKey: uint8ArrayToBase64(keyPair.publicKey),
      secretKey: uint8ArrayToBase64(keyPair.secretKey),
    })

    const plaintextBytes = decodeUTF8(keyBundle)
    const nonce = nacl.randomBytes(nacl.secretbox.nonceLength)
    const ciphertext = nacl.secretbox(plaintextBytes, nonce, derivedKey)

    // Combine nonce and ciphertext
    const combined = new Uint8Array(nonce.length + ciphertext.length)
    combined.set(nonce)
    combined.set(ciphertext, nonce.length)

    return {
      encryptedBlob: uint8ArrayToBase64(combined),
      salt: uint8ArrayToBase64(salt),
    }
  }

  /**
   * Decrypt the key pair from storage
   */
  decryptKeyPairFromStorage(
    encryptedBlob: string,
    salt: string,
    password: string
  ): IdentityKeyPair {
    const saltBytes = base64ToUint8Array(salt)
    const derivedKey = this.deriveKeyFromPassword(password, saltBytes)

    const combined = base64ToUint8Array(encryptedBlob)
    const nonce = combined.slice(0, nacl.secretbox.nonceLength)
    const ciphertext = combined.slice(nacl.secretbox.nonceLength)

    const plaintextBytes = nacl.secretbox.open(ciphertext, nonce, derivedKey)
    if (!plaintextBytes) {
      throw new Error('Failed to decrypt keys - wrong password?')
    }

    const keyBundle = JSON.parse(encodeUTF8(plaintextBytes))

    return {
      publicKey: base64ToUint8Array(keyBundle.publicKey),
      secretKey: base64ToUint8Array(keyBundle.secretKey),
    }
  }
}

// Export singleton instance
export const cryptoService = new CryptoService()
