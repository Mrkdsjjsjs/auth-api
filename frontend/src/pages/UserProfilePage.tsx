import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { useChatStore } from '../store/chatStore'
import { usersApi } from '../services/api'
import { ArrowLeft, MessageCircle, AtSign } from 'lucide-react'

const AVATAR_EMOJIS = ['🦊', '🐼', '🦁', '🐯', '🐻', '🐨', '🐸', '🐵', '🦄', '🐲', '🦋', '🌸', '🌺', '🌻', '🍀', '⭐', '🌙', '🔥', '💎', '🎯', '🎨', '🎭', '🎪', '🎬', '🎤', '🎸', '🎹', '🎺', '🥁', '🎮']

function getEmojiAvatar(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash) + id.charCodeAt(i)
    hash = hash & hash
  }
  return AVATAR_EMOJIS[Math.abs(hash) % AVATAR_EMOJIS.length]
}

interface UserProfile {
  id: string
  username?: string
  display_name?: string
  avatar_url?: string
  bio?: string
  is_online?: boolean
}

export default function UserProfilePage() {
  const { userId } = useParams<{ userId: string }>()
  const navigate = useNavigate()
  const { user: currentUser } = useAuthStore()
  const { createChat } = useChatStore()

  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (userId) {
      loadProfile(userId)
    }
  }, [userId])

  const loadProfile = async (id: string) => {
    setIsLoading(true)
    setError(null)
    try {
      const { data } = await usersApi.getById(id)
      setProfile(data)
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to load profile')
    } finally {
      setIsLoading(false)
    }
  }

  const handleStartChat = async () => {
    if (!profile) return
    try {
      const chatId = await createChat(profile.id)
      navigate(`/chat`)
      // Select the chat after navigation
      setTimeout(() => {
        useChatStore.getState().selectChat(chatId)
      }, 100)
    } catch (err) {
      console.error('Failed to create chat:', err)
    }
  }

  if (isLoading) {
    return (
      <div className="user-profile-page">
        <div className="profile-container">
          <div className="profile-loading">Loading...</div>
        </div>
        <style>{styles}</style>
      </div>
    )
  }

  if (error || !profile) {
    return (
      <div className="user-profile-page">
        <div className="profile-container">
          <div className="profile-header">
            <button className="icon-btn" onClick={() => navigate(-1)}>
              <ArrowLeft size={20} />
            </button>
            <h2>Profile</h2>
            <div style={{ width: 36 }} />
          </div>
          <div className="profile-error">{error || 'User not found'}</div>
        </div>
        <style>{styles}</style>
      </div>
    )
  }

  const isOwnProfile = currentUser?.id === profile.id

  return (
    <div className="user-profile-page">
      <div className="profile-container">
        <div className="profile-header">
          <button className="icon-btn" onClick={() => navigate(-1)}>
            <ArrowLeft size={20} />
          </button>
          <h2>Profile</h2>
          <div style={{ width: 36 }} />
        </div>

        <div className="profile-avatar-section">
          <div className="profile-avatar emoji-avatar-large">
            {profile.avatar_url?.startsWith('emoji:') ? (
              <span className="emoji-display">{profile.avatar_url.slice(6)}</span>
            ) : profile.avatar_url?.match(/\.(mp4|webm|mov)$/i) ? (
              <video src={profile.avatar_url} autoPlay loop muted playsInline className="avatar-video" />
            ) : profile.avatar_url ? (
              <img src={profile.avatar_url} alt="Avatar" />
            ) : (
              <span className="emoji-display">{getEmojiAvatar(profile.id)}</span>
            )}
          </div>
          <div className="profile-name">
            {profile.display_name || profile.username || 'Anonymous'}
          </div>
          {profile.username && (
            <div className="profile-username">
              <AtSign size={14} />
              {profile.username}
            </div>
          )}
          <div className={`profile-status ${profile.is_online ? 'online' : ''}`}>
            {profile.is_online ? 'Online' : 'Offline'}
          </div>
        </div>

        {profile.bio && (
          <div className="profile-bio-section">
            <label>Bio</label>
            <div className="profile-bio">{profile.bio}</div>
          </div>
        )}

        {!isOwnProfile && (
          <button className="btn btn-primary message-btn" onClick={handleStartChat}>
            <MessageCircle size={18} />
            Send Message
          </button>
        )}

        {isOwnProfile && (
          <button className="btn btn-secondary" onClick={() => navigate('/profile')}>
            Edit Profile
          </button>
        )}
      </div>
      <style>{styles}</style>
    </div>
  )
}

const styles = `
  .user-profile-page {
    min-height: 100vh;
    background: var(--bg-primary);
    padding: 20px;
  }

  .profile-container {
    max-width: 400px;
    margin: 0 auto;
    background: var(--bg-secondary);
    border-radius: 16px;
    padding: 24px;
  }

  .profile-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 24px;
  }

  .profile-header h2 {
    font-size: 20px;
    font-weight: 600;
  }

  .profile-loading,
  .profile-error {
    text-align: center;
    padding: 40px;
    color: var(--text-secondary);
  }

  .profile-avatar-section {
    text-align: center;
    margin-bottom: 24px;
  }

  .profile-avatar {
    width: 120px;
    height: 120px;
    border-radius: 50%;
    background: var(--accent);
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 0 auto 16px;
    font-size: 48px;
    overflow: hidden;
  }

  .emoji-avatar-large {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  }

  .emoji-display {
    font-size: 56px;
  }

  .profile-avatar img,
  .profile-avatar video,
  .avatar-video {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .profile-name {
    font-size: 24px;
    font-weight: 600;
    margin-bottom: 4px;
  }

  .profile-username {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    color: var(--text-secondary);
    font-size: 15px;
    margin-bottom: 8px;
  }

  .profile-status {
    font-size: 14px;
    color: var(--text-secondary);
  }

  .profile-status.online {
    color: var(--success);
  }

  .profile-bio-section {
    margin-bottom: 24px;
  }

  .profile-bio-section label {
    display: block;
    font-size: 14px;
    font-weight: 500;
    color: var(--text-secondary);
    margin-bottom: 8px;
  }

  .profile-bio {
    padding: 12px;
    background: var(--bg-primary);
    border-radius: 8px;
    font-size: 15px;
    color: var(--text-primary);
    white-space: pre-wrap;
  }

  .btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    width: 100%;
    padding: 14px 20px;
    border-radius: 10px;
    font-size: 16px;
    font-weight: 500;
    cursor: pointer;
    border: none;
    transition: all 0.2s;
  }

  .btn-primary {
    background: var(--accent);
    color: white;
  }

  .btn-primary:hover {
    background: var(--accent-hover);
  }

  .btn-secondary {
    background: var(--bg-primary);
    color: var(--text-primary);
    border: 1px solid var(--border);
  }

  .btn-secondary:hover {
    background: var(--bg-tertiary);
  }

  .message-btn {
    margin-bottom: 12px;
  }

  .icon-btn {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: transparent;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
  }

  .icon-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
`
