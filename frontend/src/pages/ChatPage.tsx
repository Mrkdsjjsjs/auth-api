import { useEffect, useState } from 'react'
import { useAuthStore } from '../store/authStore'
import { useChatStore } from '../store/chatStore'
import { usersApi } from '../services/api'
import wsService from '../services/websocket'
import { format } from 'date-fns'
import { Send, Plus, LogOut, Search, MessageCircle, X } from 'lucide-react'

export default function ChatPage() {
  const { user, logout, loadUser } = useAuthStore()
  const {
    chats,
    currentChatId,
    messages,
    typingUsers,
    loadChats,
    selectChat,
    sendMessage,
    createChat,
    setupWebSocket,
  } = useChatStore()

  const [messageText, setMessageText] = useState('')
  const [showNewChat, setShowNewChat] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<any[]>([])
  const [typingTimeout, setTypingTimeout] = useState<NodeJS.Timeout | null>(null)

  useEffect(() => {
    loadUser()
    loadChats()
    setupWebSocket()
  }, [])

  const currentChat = chats.find((c) => c.id === currentChatId)

  const getOtherUser = (chat: typeof currentChat) => {
    if (!chat || !user) return null
    const otherMember = chat.members.find((m) => m.user_id !== user.id)
    return otherMember?.user
  }

  const getChatName = (chat: typeof currentChat) => {
    if (!chat) return ''
    if (chat.name) return chat.name
    const otherUser = getOtherUser(chat)
    return otherUser?.display_name || otherUser?.username || 'Unknown'
  }

  const handleSend = async () => {
    if (!messageText.trim()) return
    await sendMessage(messageText)
    setMessageText('')

    // Stop typing indicator
    if (currentChatId) {
      wsService.sendTyping(currentChatId, false)
    }
  }

  const handleTyping = () => {
    if (!currentChatId) return

    wsService.sendTyping(currentChatId, true)

    // Clear previous timeout
    if (typingTimeout) clearTimeout(typingTimeout)

    // Set new timeout to stop typing
    const timeout = setTimeout(() => {
      wsService.sendTyping(currentChatId, false)
    }, 2000)

    setTypingTimeout(timeout)
  }

  const handleSearch = async (query: string) => {
    setSearchQuery(query)
    if (query.length < 2) {
      setSearchResults([])
      return
    }

    try {
      const { data } = await usersApi.search(query)
      setSearchResults(data.users)
    } catch {
      setSearchResults([])
    }
  }

  const handleStartChat = async (userId: string) => {
    try {
      const chatId = await createChat(userId)
      setShowNewChat(false)
      setSearchQuery('')
      setSearchResults([])
      selectChat(chatId)
    } catch {
      // Error handled
    }
  }

  const typingInCurrentChat = currentChatId ? typingUsers[currentChatId] || [] : []

  return (
    <div className="chat-layout">
      {/* Sidebar */}
      <div className="sidebar">
        <div className="sidebar-header">
          <h2 className="sidebar-title">Chats</h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="icon-btn" onClick={() => setShowNewChat(true)}>
              <Plus size={20} />
            </button>
            <button className="icon-btn" onClick={logout}>
              <LogOut size={20} />
            </button>
          </div>
        </div>

        <div className="chat-list">
          {chats.length === 0 ? (
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-secondary)' }}>
              No chats yet. Start a new conversation!
            </div>
          ) : (
            chats.map((chat) => (
              <div
                key={chat.id}
                className={`chat-item ${chat.id === currentChatId ? 'active' : ''}`}
                onClick={() => selectChat(chat.id)}
              >
                <div className="chat-avatar">
                  {getChatName(chat)?.[0]?.toUpperCase() || '?'}
                </div>
                <div className="chat-info">
                  <div className="chat-name">{getChatName(chat)}</div>
                  <div className="chat-last-message">
                    {typingUsers[chat.id]?.length ? (
                      <span style={{ color: 'var(--accent)' }}>typing...</span>
                    ) : (
                      'Start chatting'
                    )}
                  </div>
                </div>
                <div className="chat-meta">
                  {chat.last_message_at && (
                    <div className="chat-time">
                      {format(new Date(chat.last_message_at), 'HH:mm')}
                    </div>
                  )}
                  {chat.unread_count > 0 && (
                    <div className="chat-unread">{chat.unread_count}</div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="chat-main">
        {currentChat ? (
          <>
            <div className="chat-header">
              <div className="chat-avatar" style={{ width: 40, height: 40 }}>
                {getChatName(currentChat)?.[0]?.toUpperCase()}
              </div>
              <div className="chat-header-info">
                <div className="chat-header-name">{getChatName(currentChat)}</div>
                <div
                  className={`chat-header-status ${
                    getOtherUser(currentChat)?.is_online ? 'online' : ''
                  }`}
                >
                  {getOtherUser(currentChat)?.is_online ? 'online' : 'offline'}
                </div>
              </div>
            </div>

            <div className="messages-container">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`message ${msg.sender_id === user?.id ? 'sent' : 'received'}`}
                >
                  <div className="message-bubble">
                    {msg.is_deleted ? (
                      <em style={{ opacity: 0.5 }}>Message deleted</em>
                    ) : (
                      msg.content
                    )}
                  </div>
                  <div className="message-time">
                    {format(new Date(msg.created_at), 'HH:mm')}
                    {msg.is_edited && ' • edited'}
                  </div>
                </div>
              ))}

              {typingInCurrentChat.length > 0 && (
                <div className="typing-indicator">Someone is typing...</div>
              )}
            </div>

            <div className="message-input-container">
              <input
                type="text"
                className="message-input"
                placeholder="Type a message..."
                value={messageText}
                onChange={(e) => {
                  setMessageText(e.target.value)
                  handleTyping()
                }}
                onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              />
              <button
                className="send-btn"
                onClick={handleSend}
                disabled={!messageText.trim()}
              >
                <Send size={20} />
              </button>
            </div>
          </>
        ) : (
          <div className="empty-state">
            <div className="empty-state-icon">
              <MessageCircle size={64} />
            </div>
            <div className="empty-state-text">Select a chat to start messaging</div>
          </div>
        )}
      </div>

      {/* New Chat Modal */}
      {showNewChat && (
        <div className="modal-overlay" onClick={() => setShowNewChat(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 className="modal-title">New Chat</h3>
              <button className="icon-btn" onClick={() => setShowNewChat(false)}>
                <X size={20} />
              </button>
            </div>

            <div style={{ position: 'relative' }}>
              <Search
                size={18}
                style={{
                  position: 'absolute',
                  left: 12,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--text-secondary)',
                }}
              />
              <input
                type="text"
                className="search-input"
                placeholder="Search users..."
                value={searchQuery}
                onChange={(e) => handleSearch(e.target.value)}
                style={{ paddingLeft: 40 }}
              />
            </div>

            <div>
              {searchResults.map((u) => (
                <div
                  key={u.id}
                  className="user-item"
                  onClick={() => handleStartChat(u.id)}
                >
                  <div className="user-avatar">
                    {(u.display_name || u.username || u.id)?.[0]?.toUpperCase()}
                  </div>
                  <div>
                    <div className="user-name">
                      {u.display_name || u.username || 'User'}
                    </div>
                    {u.username && <div className="user-email">@{u.username}</div>}
                  </div>
                </div>
              ))}

              {searchQuery.length >= 2 && searchResults.length === 0 && (
                <div style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: 20 }}>
                  No users found
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
