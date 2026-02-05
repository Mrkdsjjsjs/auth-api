import nacl from 'tweetnacl'
import { encodeBase64, decodeBase64, encodeUTF8 } from 'tweetnacl-util'

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
}

// Export singleton instance
export const cryptoService = new CryptoService()
