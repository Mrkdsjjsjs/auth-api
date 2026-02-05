import { create } from 'zustand'
import { chatsApi, messagesApi } from '../services/api'
import wsService from '../services/websocket'

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
      set({ messages: data.messages, isLoading: false })

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
    const { currentChatId } = get()
    if (!currentChatId || !content.trim()) return

    try {
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
    wsService.on('new_message', (data) => {
      const { currentChatId, chats } = get()
      const message = data.message

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
