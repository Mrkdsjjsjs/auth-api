import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { useChatStore } from '../store/chatStore'
import { useEncryptionStore } from '../store/encryptionStore'
import { usersApi } from '../services/api'
import wsService from '../services/websocket'
import { format } from 'date-fns'
import { Send, Plus, LogOut, Search, MessageCircle, X, User, Lock, Unlock, ArrowLeft } from 'lucide-react'

// Emoji avatars based on user id hash
const AVATAR_EMOJIS = ['🦊', '🐼', '🦁', '🐯', '🐻', '🐨', '🐸', '🐵', '🦄', '🐲', '🦋', '🌸', '🌺', '🌻', '🍀', '⭐', '🌙', '🔥', '💎', '🎯', '🎨', '🎭', '🎪', '🎬', '🎤', '🎸', '🎹', '🎺', '🥁', '🎮']

function getEmojiAvatar(id: string): string {
  // Simple hash based on id
  let hash = 0
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash) + id.charCodeAt(i)
    hash = hash & hash
  }
  return AVATAR_EMOJIS[Math.abs(hash) % AVATAR_EMOJIS.length]
}

export default function ChatPage() {
  const navigate = useNavigate()
  const { user, logout, loadUser } = useAuthStore()
  const { isInitialized: encryptionInitialized, hasKeys } = useEncryptionStore()
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
  const [showSidebar, setShowSidebar] = useState(true)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    loadUser()
    loadChats()
    setupWebSocket()
  }, [])

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

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

  const getChatAvatar = (chat: typeof currentChat) => {
    if (!chat) return null
    if (chat.avatar_url) return chat.avatar_url
    const otherUser = getOtherUser(chat)
    return otherUser?.avatar_url || null
  }

  const renderAvatar = (avatarUrl: string | null | undefined, id: string, size: 'small' | 'large' = 'small') => {
    if (avatarUrl?.startsWith('emoji:')) {
      return <span className={size === 'large' ? 'emoji-lg' : ''}>{avatarUrl.slice(6)}</span>
    }
    if (avatarUrl) {
      return <img src={avatarUrl} alt="" className="avatar-img" />
    }
    return getEmojiAvatar(id)
  }

  const handleSelectChat = (chatId: string) => {
    selectChat(chatId)
    // Hide sidebar on mobile when chat is selected
    if (window.innerWidth <= 768) {
      setShowSidebar(false)
    }
  }

  const handleBackToList = () => {
    setShowSidebar(true)
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
      handleSelectChat(chatId)
    } catch {
      // Error handled
    }
  }

  const typingInCurrentChat = currentChatId ? typingUsers[currentChatId] || [] : []

  return (
    <div className="chat-layout">
      {/* Sidebar */}
      <div className={`sidebar ${!showSidebar ? 'hidden-mobile' : ''}`}>
        <div className="sidebar-header">
          <h2 className="sidebar-title">Chats</h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="icon-btn"
              onClick={() => setShowNewChat(true)}
              title="New chat"
            >
              <Plus size={20} />
            </button>
            <button
              className="icon-btn"
              onClick={() => navigate('/profile')}
              title="Profile"
            >
              <User size={20} />
            </button>
            <button className="icon-btn" onClick={logout} title="Logout">
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
            chats.map((chat) => {
              const avatarUrl = getChatAvatar(chat)
              const otherUser = getOtherUser(chat)
              const lastMsg = chat.last_message
              return (
                <div
                  key={chat.id}
                  className={`chat-item ${chat.id === currentChatId ? 'active' : ''}`}
                  onClick={() => handleSelectChat(chat.id)}
                >
                  <div className="chat-avatar emoji-avatar">
                    {renderAvatar(avatarUrl, otherUser?.id || chat.id)}
                  </div>
                  <div className="chat-info">
                    <div className="chat-name">{getChatName(chat)}</div>
                    <div className="chat-last-message">
                      {typingUsers[chat.id]?.length ? (
                        <span style={{ color: 'var(--accent)' }}>typing...</span>
                      ) : lastMsg?.content ? (
                        lastMsg.sender_id === user?.id ? `You: ${lastMsg.content}` : lastMsg.content
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
              )
            })
          )}
        </div>
      </div>

      {/* Main Chat Area */}
      <div className={`chat-main ${showSidebar ? 'hidden-mobile' : ''}`}>
        {currentChat ? (
          <>
            <div className="chat-header">
              <button
                className="icon-btn back-btn-mobile"
                onClick={handleBackToList}
                title="Back to chats"
              >
                <ArrowLeft size={20} />
              </button>
              <div className="chat-avatar emoji-avatar" style={{ width: 40, height: 40 }}>
                {renderAvatar(getChatAvatar(currentChat), getOtherUser(currentChat)?.id || currentChat.id)}
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
              <div
                className="encryption-indicator"
                title={encryptionInitialized && hasKeys ? 'E2E Encryption Active' : 'Encryption Not Active'}
                style={{
                  marginLeft: 'auto',
                  color: encryptionInitialized && hasKeys ? '#22c55e' : 'var(--text-secondary)',
                }}
              >
                {encryptionInitialized && hasKeys ? <Lock size={18} /> : <Unlock size={18} />}
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
              <div ref={messagesEndRef} />
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
                  <div className="user-avatar emoji-avatar">
                    {renderAvatar(u.avatar_url, u.id)}
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
