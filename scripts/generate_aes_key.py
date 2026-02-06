#!/usr/bin/env python3
"""
Generate a secure AES key for message storage encryption.
Run this script and add the output to your .env file as AES_STORAGE_KEY.
"""
import base64
import os

# Generate 32 bytes (256 bits) for AES-256
key = os.urandom(32)
key_b64 = base64.b64encode(key).decode('utf-8')

print("Generated AES Storage Key:")
print(f"AES_STORAGE_KEY={key_b64}")
print()
print("Add this to your .env file or environment variables.")
print("WARNING: Keep this key safe! If you lose it, you won't be able to decrypt stored messages.")
