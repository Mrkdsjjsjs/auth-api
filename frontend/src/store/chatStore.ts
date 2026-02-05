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

interface LastMessage {
  id: string
  content: string | null
  sender_id: string
  created_at: string
}

interface Chat {
  id: string
  type: string
  name?: string
  avatar_url?: string
  members: { user_id: string; user?: User }[]
  unread_count: number
  last_message_at?: string
  last_message?: LastMessage | null
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
        // Update last_message and last_message_at for current chat and move to top
        chats: [...state.chats]
          .map((c) => c.id === currentChatId
            ? {
                ...c,
                last_message_at: new Date().toISOString(),
                last_message: {
                  id: data.id,
                  content: content,
                  sender_id: currentUser?.id || '',
                  created_at: new Date().toISOString(),
                }
              }
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
    // Use unique=true to prevent duplicate registrations on re-render
    wsService.on('new_message', async (data) => {
      console.log('[WS] Received new_message:', data.message?.id)

      try {
        // Check if chat exists in our list, if not reload chats
        const { chats, loadChats } = get()
        const chatExists = chats.some(c => c.id === data.message.chat_id)
        if (!chatExists) {
          console.log('[WS] Chat not in list, reloading chats')
          await loadChats()
        }

        // Decrypt the message
        const decryptedMessage = await decryptMessage(data.message)
        console.log('[WS] Decrypted message:', decryptedMessage.id, 'content:', decryptedMessage.content?.substring(0, 20))

        // Get fresh state after async operations
        const { currentChatId, messages } = get()

        if (decryptedMessage.chat_id === currentChatId) {
          console.log('[WS] Message is for current chat')
          // Check if message already exists (avoid duplicates) - use fresh state
          const existsById = messages.some(m => m.id === decryptedMessage.id)
          // Also check for temp messages we added optimistically
          const tempMessage = messages.find(m =>
            m.id.startsWith('temp-') &&
            m.sender_id === decryptedMessage.sender_id &&
            m.content === decryptedMessage.content
          )

          if (tempMessage) {
            console.log('[WS] Replacing temp message:', tempMessage.id)
            // Replace temp message with real one from server
            set((state) => ({
              messages: state.messages.map(m =>
                m.id === tempMessage.id ? decryptedMessage : m
              ),
            }))
          } else if (!existsById) {
            console.log('[WS] Adding new message to state')
            set((state) => {
              console.log('[WS] Current messages count:', state.messages.length)
              const newMessages = [...state.messages, decryptedMessage]
              console.log('[WS] New messages count:', newMessages.length)
              return { messages: newMessages }
            })
          } else {
            console.log('[WS] Message already exists, skipping')
          }
          // Mark as read
          messagesApi.markRead(decryptedMessage.id)
        } else {
          console.log('[WS] Message is for different chat:', decryptedMessage.chat_id)
          // Update unread count and last_message for non-current chat
          set((state) => ({
            chats: state.chats.map((c) =>
              c.id === decryptedMessage.chat_id
                ? {
                    ...c,
                    unread_count: c.unread_count + 1,
                    last_message_at: decryptedMessage.created_at,
                    last_message: {
                      id: decryptedMessage.id,
                      content: decryptedMessage.content,
                      sender_id: decryptedMessage.sender_id,
                      created_at: decryptedMessage.created_at,
                    }
                  }
                : c
            ),
          }))
        }

        // Update last_message for current chat too and move to top
        set((state) => ({
          chats: [...state.chats]
            .map((c) =>
              c.id === decryptedMessage.chat_id
                ? {
                    ...c,
                    last_message_at: decryptedMessage.created_at,
                    last_message: {
                      id: decryptedMessage.id,
                      content: decryptedMessage.content,
                      sender_id: decryptedMessage.sender_id,
                      created_at: decryptedMessage.created_at,
                    }
                  }
                : c
            )
            .sort((a, b) => {
              const aTime = a.last_message_at ? new Date(a.last_message_at).getTime() : 0
              const bTime = b.last_message_at ? new Date(b.last_message_at).getTime() : 0
              return bTime - aTime
            }),
        }))
      } catch (error) {
        console.error('[WS] Error handling new_message:', error)
      }
    }, true)

    // Handle message edits
    wsService.on('message_edited', async (data) => {
      const decryptedMessage = await decryptMessage(data.message)
      set((state) => ({
        messages: state.messages.map((m) =>
          m.id === decryptedMessage.id ? decryptedMessage : m
        ),
      }))
    }, true)

    // Handle message deletes
    wsService.on('message_deleted', (data) => {
      set((state) => ({
        messages: state.messages.map((m) =>
          m.id === data.message_id ? { ...m, is_deleted: true, content: '' } : m
        ),
      }))
    }, true)

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
    }, true)

    wsService.on('typing_stop', (data) => {
      set((state) => ({
        typingUsers: {
          ...state.typingUsers,
          [data.chat_id]: (state.typingUsers[data.chat_id] || []).filter(
            (id) => id !== data.user_id
          ),
        },
      }))
    }, true)

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
    }, true)

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
    }, true)
  },
}))
