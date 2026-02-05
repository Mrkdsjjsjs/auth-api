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

  /**
   * Encrypt a message for a recipient using their public key
   * Uses ephemeral key pair for forward secrecy
   */
  encryptForRecipient(
    plaintext: string,
    recipientPublicKey: Uint8Array
  ): { ciphertext: string; nonce: string; ephemeralPublicKey: string } {
    // Generate ephemeral key pair for this message
    const ephemeralKeyPair = nacl.box.keyPair()

    // Generate random nonce
    const nonce = nacl.randomBytes(nacl.box.nonceLength)

    // Encrypt the message
    const messageBytes = new TextEncoder().encode(plaintext)
    const ciphertext = nacl.box(messageBytes, nonce, recipientPublicKey, ephemeralKeyPair.secretKey)

    return {
      ciphertext: uint8ArrayToBase64(ciphertext),
      nonce: uint8ArrayToBase64(nonce),
      ephemeralPublicKey: uint8ArrayToBase64(ephemeralKeyPair.publicKey),
    }
  }

  /**
   * Encrypt a file using symmetric encryption (secretbox)
   * Returns encrypted file + key encrypted for recipient
   */
  encryptFile(
    fileData: Uint8Array,
    recipientPublicKey: Uint8Array
  ): {
    encryptedFile: Uint8Array
    fileNonce: Uint8Array
    encryptedKey: string
    keyNonce: string
    ephemeralPublicKey: string
  } {
    // Generate random symmetric key for file
    const fileKey = nacl.randomBytes(nacl.secretbox.keyLength)
    const fileNonce = nacl.randomBytes(nacl.secretbox.nonceLength)

    // Encrypt file with symmetric key
    const encryptedFile = nacl.secretbox(fileData, fileNonce, fileKey)

    // Encrypt the file key for recipient using asymmetric encryption
    const ephemeralKeyPair = nacl.box.keyPair()
    const keyNonce = nacl.randomBytes(nacl.box.nonceLength)
    const encryptedKey = nacl.box(fileKey, keyNonce, recipientPublicKey, ephemeralKeyPair.secretKey)

    return {
      encryptedFile,
      fileNonce,
      encryptedKey: uint8ArrayToBase64(encryptedKey),
      keyNonce: uint8ArrayToBase64(keyNonce),
      ephemeralPublicKey: uint8ArrayToBase64(ephemeralKeyPair.publicKey),
    }
  }

  /**
   * Decrypt a file
   */
  decryptFile(
    encryptedFile: Uint8Array,
    fileNonce: Uint8Array,
    encryptedKey: Uint8Array,
    keyNonce: Uint8Array,
    ephemeralPublicKey: Uint8Array,
    recipientSecretKey: Uint8Array
  ): Uint8Array {
    // Decrypt the file key
    const fileKey = nacl.box.open(encryptedKey, keyNonce, ephemeralPublicKey, recipientSecretKey)
    if (!fileKey) {
      throw new Error('Failed to decrypt file key')
    }

    // Decrypt the file
    const decryptedFile = nacl.secretbox.open(encryptedFile, fileNonce, fileKey)
    if (!decryptedFile) {
      throw new Error('Failed to decrypt file')
    }

    return decryptedFile
  }

  /**
   * Encrypt a file for both sender and recipient (dual encryption)
   * Used for E2E encrypted file sharing
   */
  encryptFileForBoth(
    fileData: Uint8Array,
    recipientPublicKey: Uint8Array,
    senderPublicKey: Uint8Array
  ): {
    encryptedFile: Uint8Array
    fileNonce: string
    keyForRecipient: {
      encryptedKey: string
      keyNonce: string
      ephemeralPublicKey: string
    }
    keyForSender: {
      encryptedKey: string
      keyNonce: string
      ephemeralPublicKey: string
    }
  } {
    // Generate random symmetric key for file
    const fileKey = nacl.randomBytes(nacl.secretbox.keyLength)
    const fileNonce = nacl.randomBytes(nacl.secretbox.nonceLength)

    // Encrypt file with symmetric key
    const encryptedFile = nacl.secretbox(fileData, fileNonce, fileKey)

    // Encrypt the file key for recipient
    const ephemeralKeyPairRecipient = nacl.box.keyPair()
    const keyNonceRecipient = nacl.randomBytes(nacl.box.nonceLength)
    const encryptedKeyRecipient = nacl.box(
      fileKey,
      keyNonceRecipient,
      recipientPublicKey,
      ephemeralKeyPairRecipient.secretKey
    )

    // Encrypt the file key for sender
    const ephemeralKeyPairSender = nacl.box.keyPair()
    const keyNonceSender = nacl.randomBytes(nacl.box.nonceLength)
    const encryptedKeySender = nacl.box(
      fileKey,
      keyNonceSender,
      senderPublicKey,
      ephemeralKeyPairSender.secretKey
    )

    return {
      encryptedFile,
      fileNonce: uint8ArrayToBase64(fileNonce),
      keyForRecipient: {
        encryptedKey: uint8ArrayToBase64(encryptedKeyRecipient),
        keyNonce: uint8ArrayToBase64(keyNonceRecipient),
        ephemeralPublicKey: uint8ArrayToBase64(ephemeralKeyPairRecipient.publicKey),
      },
      keyForSender: {
        encryptedKey: uint8ArrayToBase64(encryptedKeySender),
        keyNonce: uint8ArrayToBase64(keyNonceSender),
        ephemeralPublicKey: uint8ArrayToBase64(ephemeralKeyPairSender.publicKey),
      },
    }
  }
}

// Export singleton instance
export const cryptoService = new CryptoService()
