import { create } from 'zustand'
import { chatsApi, messagesApi } from '../services/api'
import wsService from '../services/websocket'
import { useEncryptionStore } from './encryptionStore'
import { useAuthStore } from './authStore'

interface User {
  id: string
  username?: string
  display_name?: string
  avatar_url?: string
  is_online?: boolean
}

interface Message {
  id: string
  chat_id: string
  sender_id: string
  content: string
  message_type: string
  is_edited: boolean
  is_deleted: boolean
  created_at: string
  sender?: User
  // E2E encryption fields
  encrypted_content?: string | null
  encryption_version?: number
  sender_key_id?: string | null
  ephemeral_public_key?: string | null
}

interface Chat {
  id: string
  type: string
  name?: string
  avatar_url?: string
  members: { user_id: string; user?: User }[]
  unread_count: number
  last_message_at?: string
}

interface ChatState {
  chats: Chat[]
  currentChatId: string | null
  messages: Message[]
  typingUsers: { [chatId: string]: string[] }
  isLoading: boolean

  loadChats: () => Promise<void>
  selectChat: (chatId: string) => Promise<void>
  sendMessage: (content: string) => Promise<void>
  createChat: (userId: string) => Promise<string>
  setupWebSocket: () => void
}

export const useChatStore = create<ChatState>((set, get) => ({
  chats: [],
  currentChatId: null,
  messages: [],
  typingUsers: {},
  isLoading: false,

  loadChats: async () => {
    try {
      const { data } = await chatsApi.list()
      set({ chats: data.chats })
    } catch (error) {
      console.error('Failed to load chats:', error)
    }
  },

  selectChat: async (chatId) => {
    set({ currentChatId: chatId, messages: [], isLoading: true })

    try {
      const { data } = await messagesApi.list(chatId)
      const { chats } = get()
      const chat = chats.find(c => c.id === chatId)

      // Decrypt messages if needed
      const encryptionStore = useEncryptionStore.getState()
      let decryptedMessages = data.messages

      if (encryptionStore.isInitialized && encryptionStore.hasKeys && chat) {
        decryptedMessages = await Promise.all(
          data.messages.map(async (message: Message) => {
            if (message.encryption_version && message.encryption_version > 0 && message.encrypted_content) {
              try {
                const decryptedContent = await encryptionStore.decryptMessage(
                  {
                    encrypted_content: message.encrypted_content,
                    encryption_version: message.encryption_version,
                    sender_id: message.sender_id,
                    chat_id: message.chat_id,
                    ephemeral_public_key: message.ephemeral_public_key,
                  },
                  chat.type as 'direct' | 'group'
                )
                return { ...message, content: decryptedContent }
              } catch (error) {
                console.warn('Failed to decrypt message:', message.id, error)
                return { ...message, content: '[Encrypted message - unable to decrypt]' }
              }
            }
            return message
          })
        )
      } else {
        // Mark encrypted messages as such
        decryptedMessages = data.messages.map((message: Message) => {
          if (message.encryption_version && message.encryption_version > 0 && message.encrypted_content) {
            return { ...message, content: '[Encrypted message]' }
          }
          return message
        })
      }

      set({ messages: decryptedMessages, isLoading: false })

      // Mark last message as read
      if (data.messages.length > 0) {
        const lastMessage = data.messages[data.messages.length - 1]
        await messagesApi.markRead(lastMessage.id)

        // Update unread count
        set((state) => ({
          chats: state.chats.map((c) =>
            c.id === chatId ? { ...c, unread_count: 0 } : c
          ),
        }))
      }
    } catch (error) {
      console.error('Failed to load messages:', error)
      set({ isLoading: false })
    }
  },

  sendMessage: async (content) => {
    const { currentChatId, chats } = get()
    if (!currentChatId || !content.trim()) return

    const chat = chats.find(c => c.id === currentChatId)
    if (!chat) return

    try {
      const encryptionStore = useEncryptionStore.getState()
      const authStore = useAuthStore.getState()

      // Try to encrypt the message if encryption is initialized
      if (encryptionStore.isInitialized && encryptionStore.hasKeys) {
        try {
          const chatType = chat.type as 'direct' | 'group'

          // For direct chats, find the other user
          let recipientUserId: string | undefined
          if (chatType === 'direct' && authStore.user) {
            const otherMember = chat.members.find(m => m.user_id !== authStore.user?.id)
            recipientUserId = otherMember?.user_id
          }

          const encrypted = await encryptionStore.encryptMessage(
            currentChatId,
            content,
            chatType,
            recipientUserId
          )

          // Convert to snake_case for API
          const { data } = await messagesApi.send(currentChatId, '', undefined, {
            encrypted_content: encrypted.encryptedContent,
            encryption_version: encrypted.encryptionVersion,
            sender_key_id: encrypted.senderKeyId,
            ephemeral_public_key: encrypted.ephemeralPublicKey,
          })
          // Store decrypted content locally for display
          const messageWithContent = { ...data, content }
          set((state) => ({
            messages: [...state.messages, messageWithContent],
          }))
          return
        } catch (error) {
          console.warn('Encryption failed, sending as plaintext:', error)
        }
      }

      // Fallback to plaintext
      const { data } = await messagesApi.send(currentChatId, content)
      set((state) => ({
        messages: [...state.messages, data],
      }))
    } catch (error) {
      console.error('Failed to send message:', error)
    }
  },

  createChat: async (userId) => {
    try {
      const { data } = await chatsApi.create('direct', [userId])
      set((state) => ({
        chats: [data, ...state.chats.filter((c) => c.id !== data.id)],
      }))
      return data.id
    } catch (error) {
      console.error('Failed to create chat:', error)
      throw error
    }
  },

  setupWebSocket: () => {
    // Handle new messages
    wsService.on('new_message', async (data) => {
      const { currentChatId, chats } = get()
      let message = data.message

      // Try to decrypt if message is encrypted
      if (message.encryption_version && message.encryption_version > 0 && message.encrypted_content) {
        const encryptionStore = useEncryptionStore.getState()
        const chat = chats.find(c => c.id === message.chat_id)

        if (encryptionStore.isInitialized && encryptionStore.hasKeys && chat) {
          try {
            const decryptedContent = await encryptionStore.decryptMessage(
              {
                encrypted_content: message.encrypted_content,
                encryption_version: message.encryption_version,
                sender_id: message.sender_id,
                chat_id: message.chat_id,
                ephemeral_public_key: message.ephemeral_public_key,
              },
              chat.type as 'direct' | 'group'
            )
            message = { ...message, content: decryptedContent }
          } catch (error) {
            console.warn('Failed to decrypt message:', error)
            message = { ...message, content: '[Encrypted message - unable to decrypt]' }
          }
        } else {
          message = { ...message, content: '[Encrypted message]' }
        }
      }

      if (message.chat_id === currentChatId) {
        set((state) => ({
          messages: [...state.messages, message],
        }))
        // Mark as read
        messagesApi.markRead(message.id)
      } else {
        // Update unread count
        set({
          chats: chats.map((c) =>
            c.id === message.chat_id
              ? { ...c, unread_count: c.unread_count + 1 }
              : c
          ),
        })
      }
    })

    // Handle message edits
    wsService.on('message_edited', (data) => {
      set((state) => ({
        messages: state.messages.map((m) =>
          m.id === data.message.id ? data.message : m
        ),
      }))
    })

    // Handle message deletes
    wsService.on('message_deleted', (data) => {
      set((state) => ({
        messages: state.messages.map((m) =>
          m.id === data.message_id ? { ...m, is_deleted: true, content: '' } : m
        ),
      }))
    })

    // Handle typing
    wsService.on('typing_start', (data) => {
      set((state) => ({
        typingUsers: {
          ...state.typingUsers,
          [data.chat_id]: [
            ...(state.typingUsers[data.chat_id] || []).filter(
              (id) => id !== data.user_id
            ),
            data.user_id,
          ],
        },
      }))
    })

    wsService.on('typing_stop', (data) => {
      set((state) => ({
        typingUsers: {
          ...state.typingUsers,
          [data.chat_id]: (state.typingUsers[data.chat_id] || []).filter(
            (id) => id !== data.user_id
          ),
        },
      }))
    })

    // Handle online status
    wsService.on('user_online', (data) => {
      set((state) => ({
        chats: state.chats.map((c) => ({
          ...c,
          members: c.members.map((m) =>
            m.user_id === data.user_id
              ? { ...m, user: { ...m.user!, is_online: true } }
              : m
          ),
        })),
      }))
    })

    wsService.on('user_offline', (data) => {
      set((state) => ({
        chats: state.chats.map((c) => ({
          ...c,
          members: c.members.map((m) =>
            m.user_id === data.user_id
              ? { ...m, user: { ...m.user!, is_online: false } }
              : m
          ),
        })),
      }))
    })
  },
}))
