import { x25519 } from '@noble/curves/ed25519'
import { ed25519 } from '@noble/curves/ed25519'
import { gcm } from '@noble/ciphers/aes'
import { randomBytes } from '@noble/ciphers/webcrypto'
import { pbkdf2 } from '@noble/hashes/pbkdf2'
import { sha256 } from '@noble/hashes/sha256'
import { hkdf } from '@noble/hashes/hkdf'

// Types
export interface IdentityKeyPair {
  x25519: {
    publicKey: Uint8Array
    privateKey: Uint8Array
  }
  ed25519: {
    publicKey: Uint8Array
    privateKey: Uint8Array
  }
}

export interface EncryptedPayload {
  ciphertext: string  // Base64
  nonce: string       // Base64
  ephemeralPublicKey?: string  // Base64, for direct chats
}

export interface DecryptedMessage {
  content: string
}

// Helper functions
function uint8ArrayToBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

export class CryptoService {
  /**
   * Generate a new identity key pair (X25519 for encryption, Ed25519 for signing)
   */
  generateIdentityKeyPair(): IdentityKeyPair {
    // Generate X25519 key pair for Diffie-Hellman key exchange
    const x25519PrivateKey = randomBytes(32)
    const x25519PublicKey = x25519.getPublicKey(x25519PrivateKey)

    // Generate Ed25519 key pair for signatures
    const ed25519PrivateKey = randomBytes(32)
    const ed25519PublicKey = ed25519.getPublicKey(ed25519PrivateKey)

    return {
      x25519: {
        publicKey: x25519PublicKey,
        privateKey: x25519PrivateKey,
      },
      ed25519: {
        publicKey: ed25519PublicKey,
        privateKey: ed25519PrivateKey,
      },
    }
  }

  /**
   * Derive an encryption key from password using PBKDF2
   */
  deriveKeyFromPassword(password: string, salt: Uint8Array): Uint8Array {
    return pbkdf2(sha256, password, salt, { c: 100000, dkLen: 32 })
  }

  /**
   * Generate a random salt for PBKDF2
   */
  generateSalt(): Uint8Array {
    return randomBytes(16)
  }

  /**
   * Generate a random AES-256 key for group chats
   */
  generateGroupKey(): Uint8Array {
    return randomBytes(32)
  }

  /**
   * Compute shared secret using X25519 ECDH
   */
  computeSharedSecret(
    privateKey: Uint8Array,
    publicKey: Uint8Array
  ): Uint8Array {
    const sharedPoint = x25519.getSharedSecret(privateKey, publicKey)
    // Derive a proper key using HKDF
    return hkdf(sha256, sharedPoint, undefined, 'messenger-e2e', 32)
  }

  /**
   * Encrypt data using AES-256-GCM
   */
  encrypt(plaintext: Uint8Array, key: Uint8Array): { ciphertext: Uint8Array; nonce: Uint8Array } {
    const nonce = randomBytes(12) // 96-bit nonce for GCM
    const cipher = gcm(key, nonce)
    const ciphertext = cipher.encrypt(plaintext)
    return { ciphertext, nonce }
  }

  /**
   * Decrypt data using AES-256-GCM
   */
  decrypt(ciphertext: Uint8Array, key: Uint8Array, nonce: Uint8Array): Uint8Array {
    const cipher = gcm(key, nonce)
    return cipher.decrypt(ciphertext)
  }

  /**
   * Encrypt a message for a direct chat (1-to-1)
   * Uses ephemeral key pair for forward secrecy
   */
  encryptDirectMessage(
    plaintext: string,
    recipientPublicKey: Uint8Array
  ): EncryptedPayload {
    // Generate ephemeral key pair
    const ephemeralPrivateKey = randomBytes(32)
    const ephemeralPublicKey = x25519.getPublicKey(ephemeralPrivateKey)

    // Compute shared secret with recipient's public key
    const sharedSecret = this.computeSharedSecret(ephemeralPrivateKey, recipientPublicKey)

    // Encrypt the message
    const plaintextBytes = new TextEncoder().encode(plaintext)
    const { ciphertext, nonce } = this.encrypt(plaintextBytes, sharedSecret)

    return {
      ciphertext: uint8ArrayToBase64(ciphertext),
      nonce: uint8ArrayToBase64(nonce),
      ephemeralPublicKey: uint8ArrayToBase64(ephemeralPublicKey),
    }
  }

  /**
   * Decrypt a message from a direct chat
   */
  decryptDirectMessage(
    payload: EncryptedPayload,
    privateKey: Uint8Array
  ): string {
    if (!payload.ephemeralPublicKey) {
      throw new Error('Missing ephemeral public key for direct message')
    }

    const ephemeralPublicKey = base64ToUint8Array(payload.ephemeralPublicKey)
    const ciphertext = base64ToUint8Array(payload.ciphertext)
    const nonce = base64ToUint8Array(payload.nonce)

    // Compute shared secret with sender's ephemeral public key
    const sharedSecret = this.computeSharedSecret(privateKey, ephemeralPublicKey)

    // Decrypt the message
    const plaintextBytes = this.decrypt(ciphertext, sharedSecret, nonce)
    return new TextDecoder().decode(plaintextBytes)
  }

  /**
   * Encrypt a message for a group chat using the group key
   */
  encryptGroupMessage(plaintext: string, groupKey: Uint8Array): EncryptedPayload {
    const plaintextBytes = new TextEncoder().encode(plaintext)
    const { ciphertext, nonce } = this.encrypt(plaintextBytes, groupKey)

    return {
      ciphertext: uint8ArrayToBase64(ciphertext),
      nonce: uint8ArrayToBase64(nonce),
    }
  }

  /**
   * Decrypt a message from a group chat using the group key
   */
  decryptGroupMessage(payload: EncryptedPayload, groupKey: Uint8Array): string {
    const ciphertext = base64ToUint8Array(payload.ciphertext)
    const nonce = base64ToUint8Array(payload.nonce)

    const plaintextBytes = this.decrypt(ciphertext, groupKey, nonce)
    return new TextDecoder().decode(plaintextBytes)
  }

  /**
   * Encrypt a group key for a specific user
   */
  encryptGroupKeyForUser(
    groupKey: Uint8Array,
    userPublicKey: Uint8Array,
    senderPrivateKey: Uint8Array
  ): EncryptedPayload {
    const sharedSecret = this.computeSharedSecret(senderPrivateKey, userPublicKey)
    const { ciphertext, nonce } = this.encrypt(groupKey, sharedSecret)

    return {
      ciphertext: uint8ArrayToBase64(ciphertext),
      nonce: uint8ArrayToBase64(nonce),
    }
  }

  /**
   * Decrypt a group key that was encrypted for the current user
   */
  decryptGroupKey(
    payload: EncryptedPayload,
    senderPublicKey: Uint8Array,
    privateKey: Uint8Array
  ): Uint8Array {
    const sharedSecret = this.computeSharedSecret(privateKey, senderPublicKey)
    const ciphertext = base64ToUint8Array(payload.ciphertext)
    const nonce = base64ToUint8Array(payload.nonce)

    return this.decrypt(ciphertext, sharedSecret, nonce)
  }

  /**
   * Sign data using Ed25519
   */
  sign(data: Uint8Array, privateKey: Uint8Array): Uint8Array {
    return ed25519.sign(data, privateKey)
  }

  /**
   * Verify a signature using Ed25519
   */
  verify(data: Uint8Array, signature: Uint8Array, publicKey: Uint8Array): boolean {
    try {
      return ed25519.verify(signature, data, publicKey)
    } catch {
      return false
    }
  }

  /**
   * Encrypt the identity key pair for storage (protected by password)
   */
  encryptKeyPairForStorage(
    keyPair: IdentityKeyPair,
    password: string
  ): { encryptedBlob: string; salt: string } {
    const salt = this.generateSalt()
    const derivedKey = this.deriveKeyFromPassword(password, salt)

    // Serialize the key pair
    const keyBundle = JSON.stringify({
      x25519: {
        publicKey: uint8ArrayToBase64(keyPair.x25519.publicKey),
        privateKey: uint8ArrayToBase64(keyPair.x25519.privateKey),
      },
      ed25519: {
        publicKey: uint8ArrayToBase64(keyPair.ed25519.publicKey),
        privateKey: uint8ArrayToBase64(keyPair.ed25519.privateKey),
      },
    })

    const plaintextBytes = new TextEncoder().encode(keyBundle)
    const { ciphertext, nonce } = this.encrypt(plaintextBytes, derivedKey)

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
   * Decrypt the identity key pair from storage
   */
  decryptKeyPairFromStorage(
    encryptedBlob: string,
    salt: string,
    password: string
  ): IdentityKeyPair {
    const saltBytes = base64ToUint8Array(salt)
    const derivedKey = this.deriveKeyFromPassword(password, saltBytes)

    const combined = base64ToUint8Array(encryptedBlob)
    const nonce = combined.slice(0, 12)
    const ciphertext = combined.slice(12)

    const plaintextBytes = this.decrypt(ciphertext, derivedKey, nonce)
    const keyBundle = JSON.parse(new TextDecoder().decode(plaintextBytes))

    return {
      x25519: {
        publicKey: base64ToUint8Array(keyBundle.x25519.publicKey),
        privateKey: base64ToUint8Array(keyBundle.x25519.privateKey),
      },
      ed25519: {
        publicKey: base64ToUint8Array(keyBundle.ed25519.publicKey),
        privateKey: base64ToUint8Array(keyBundle.ed25519.privateKey),
      },
    }
  }
}

// Export utility functions
export { uint8ArrayToBase64, base64ToUint8Array }

// Export singleton instance
export const cryptoService = new CryptoService()
