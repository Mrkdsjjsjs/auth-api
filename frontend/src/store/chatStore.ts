import { create } from 'zustand'
import { chatsApi, messagesApi } from '../services/api'
import wsService from '../services/websocket'
import { useEncryptionStore } from './encryptionStore'

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
  content: string | null
  message_type: string
  is_edited: boolean
  is_deleted: boolean
  created_at: string
  sender?: User
  // Encryption fields from server
  encrypted_content?: string | null
  ephemeral_public_key?: string | null
  encryption_version?: number
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

/**
 * Decrypt a message if it's encrypted
 */
async function decryptMessage(message: Message): Promise<Message> {
  // If not encrypted, return as-is
  if (!message.encryption_version || message.encryption_version === 0 || !message.encrypted_content) {
    return message
  }

  const encryptionStore = useEncryptionStore.getState()

  // If encryption not initialized, show placeholder
  if (!encryptionStore.isInitialized || !encryptionStore.hasKeys) {
    return { ...message, content: '[Encrypted - login to decrypt]' }
  }

  try {
    const decryptedContent = await encryptionStore.decryptMessage({
      encrypted_content: message.encrypted_content,
      ephemeral_public_key: message.ephemeral_public_key,
    })
    return { ...message, content: decryptedContent }
  } catch (error) {
    console.warn('Failed to decrypt message:', message.id, error)
    return { ...message, content: '[Decryption failed]' }
  }
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

      // Decrypt all messages
      const decryptedMessages = await Promise.all(
        data.messages.map((msg: Message) => decryptMessage(msg))
      )

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
    const { currentChatId, messages } = get()
    if (!currentChatId || !content.trim()) return

    // Get current user from authStore
    const authStore = (await import('./authStore')).useAuthStore.getState()
    const currentUser = authStore.user

    // Create optimistic message with temp ID
    const tempId = `temp-${Date.now()}`
    const optimisticMessage: Message = {
      id: tempId,
      chat_id: currentChatId,
      sender_id: currentUser?.id || '',
      content: content,
      message_type: 'text',
      is_edited: false,
      is_deleted: false,
      created_at: new Date().toISOString(),
      sender: currentUser ? {
        id: currentUser.id,
        username: currentUser.username,
        display_name: currentUser.display_name,
        avatar_url: currentUser.avatar_url,
      } : undefined,
    }

    // Add message optimistically
    set({ messages: [...messages, optimisticMessage] })

    try {
      // Send plaintext - server encrypts when delivering
      const { data } = await messagesApi.send(currentChatId, content)

      // Replace temp message with real one (or remove if it comes via WebSocket)
      set((state) => ({
        messages: state.messages.map((m) =>
          m.id === tempId ? { ...optimisticMessage, id: data.id } : m
        ),
        // Update last_message_at for current chat and move to top
        chats: [...state.chats]
          .map((c) => c.id === currentChatId
            ? { ...c, last_message_at: new Date().toISOString() }
            : c
          )
          .sort((a, b) => {
            const aTime = a.last_message_at ? new Date(a.last_message_at).getTime() : 0
            const bTime = b.last_message_at ? new Date(b.last_message_at).getTime() : 0
            return bTime - aTime
          }),
      }))
    } catch (error) {
      console.error('Failed to send message:', error)
      // Remove optimistic message on error
      set((state) => ({
        messages: state.messages.filter((m) => m.id !== tempId),
      }))
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
    // Handle new messages (already encrypted for us by server)
    wsService.on('new_message', async (data) => {
      const { currentChatId, chats, messages, loadChats } = get()

      // Check if chat exists in our list, if not reload chats
      const chatExists = chats.some(c => c.id === data.message.chat_id)
      if (!chatExists) {
        await loadChats()
      }

      // Decrypt the message
      const decryptedMessage = await decryptMessage(data.message)

      if (decryptedMessage.chat_id === currentChatId) {
        // Check if message already exists (avoid duplicates)
        const existsById = messages.some(m => m.id === decryptedMessage.id)
        // Also check for temp messages we added optimistically
        const tempMessage = messages.find(m =>
          m.id.startsWith('temp-') &&
          m.sender_id === decryptedMessage.sender_id &&
          m.content === decryptedMessage.content
        )

        if (tempMessage) {
          // Replace temp message with real one from server
          set((state) => ({
            messages: state.messages.map(m =>
              m.id === tempMessage.id ? decryptedMessage : m
            ),
          }))
        } else if (!existsById) {
          set((state) => ({
            messages: [...state.messages, decryptedMessage],
          }))
        }
        // Mark as read
        messagesApi.markRead(decryptedMessage.id)
      } else {
        // Update unread count
        set({
          chats: chats.map((c) =>
            c.id === decryptedMessage.chat_id
              ? { ...c, unread_count: c.unread_count + 1, last_message_at: decryptedMessage.created_at }
              : c
          ),
        })
      }

      // Move chat to top of list (sort by last_message_at)
      set((state) => ({
        chats: [...state.chats].sort((a, b) => {
          const aTime = a.last_message_at ? new Date(a.last_message_at).getTime() : 0
          const bTime = b.last_message_at ? new Date(b.last_message_at).getTime() : 0
          return bTime - aTime
        }),
      }))
    })

    // Handle message edits
    wsService.on('message_edited', async (data) => {
      const decryptedMessage = await decryptMessage(data.message)
      set((state) => ({
        messages: state.messages.map((m) =>
          m.id === decryptedMessage.id ? decryptedMessage : m
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
