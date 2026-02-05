import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { useEncryptionStore } from '../store/encryptionStore'
import { usersApi } from '../services/api'
import { ArrowLeft, Camera, Check, X, Shield, Key, Lock, Smile } from 'lucide-react'

// Emoji avatars for picker
const AVATAR_EMOJIS = ['🦊', '🐼', '🦁', '🐯', '🐻', '🐨', '🐸', '🐵', '🦄', '🐲', '🦋', '🌸', '🌺', '🌻', '🍀', '⭐', '🌙', '🔥', '💎', '🎯', '🎨', '🎭', '🎪', '🎬', '🎤', '🎸', '🎹', '🎺', '🥁', '🎮', '🚀', '🌈', '💜', '💙', '💚', '💛', '🧡', '❤️', '🖤', '🤍']

function getEmojiAvatar(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash) + id.charCodeAt(i)
    hash = hash & hash
  }
  return AVATAR_EMOJIS[Math.abs(hash) % AVATAR_EMOJIS.length]
}

export default function ProfilePage() {
  const navigate = useNavigate()
  const { user, loadUser } = useAuthStore()
  const { isInitialized, hasKeys, currentKeyId } = useEncryptionStore()

  const [isEditing, setIsEditing] = useState(false)
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [bio, setBio] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    loadUser()
  }, [])

  useEffect(() => {
    if (user) {
      setUsername(user.username || '')
      setDisplayName(user.display_name || '')
      setBio((user as any).bio || '')
    }
  }, [user])

  const handleSave = async () => {
    setError(null)
    setIsLoading(true)

    try {
      await usersApi.updateProfile({
        username: username || undefined,
        display_name: displayName || undefined,
        bio: bio || undefined,
      })
      await loadUser()
      setSuccess('Profile updated successfully')
      setIsEditing(false)
      setTimeout(() => setSuccess(null), 3000)
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to update profile')
    } finally {
      setIsLoading(false)
    }
  }

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const formData = new FormData()
    formData.append('file', file)

    setIsLoading(true)
    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_URL || ''}/api/users/me/avatar`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${localStorage.getItem('access_token')}`,
          },
          body: formData,
        }
      )

      if (!response.ok) {
        throw new Error('Failed to upload avatar')
      }

      await loadUser()
      setSuccess('Avatar updated successfully')
      setTimeout(() => setSuccess(null), 3000)
    } catch (err: any) {
      setError(err.message || 'Failed to upload avatar')
    } finally {
      setIsLoading(false)
    }
  }

  const handleEmojiAvatar = async (emoji: string) => {
    setIsLoading(true)
    setShowEmojiPicker(false)
    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_URL || ''}/api/users/me/avatar/emoji`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${localStorage.getItem('access_token')}`,
          },
          body: JSON.stringify({ emoji }),
        }
      )

      if (!response.ok) {
        throw new Error('Failed to set emoji avatar')
      }

      await loadUser()
      setSuccess('Avatar updated!')
      setTimeout(() => setSuccess(null), 3000)
    } catch (err: any) {
      setError(err.message || 'Failed to set avatar')
    } finally {
      setIsLoading(false)
    }
  }

  const handleCancel = () => {
    if (user) {
      setUsername(user.username || '')
      setDisplayName(user.display_name || '')
      setBio((user as any).bio || '')
    }
    setIsEditing(false)
    setError(null)
  }

  if (!user) {
    return (
      <div className="profile-page">
        <div className="profile-loading">Loading...</div>
      </div>
    )
  }

  return (
    <div className="profile-page">
      <div className="profile-container">
        <div className="profile-header">
          <button className="icon-btn" onClick={() => navigate('/chat')}>
            <ArrowLeft size={20} />
          </button>
          <h2>Profile</h2>
          <div style={{ width: 36 }} />
        </div>

        {error && <div className="alert alert-error">{error}</div>}
        {success && <div className="alert alert-success">{success}</div>}

        <div className="profile-avatar-section">
          <div
            className="profile-avatar emoji-avatar-large"
            onClick={() => fileInputRef.current?.click()}
          >
            {user.avatar_url?.startsWith('emoji:') ? (
              <span className="emoji-display">{user.avatar_url.slice(6)}</span>
            ) : user.avatar_url ? (
              <img src={user.avatar_url} alt="Avatar" />
            ) : (
              <span className="emoji-display">{getEmojiAvatar(user.id)}</span>
            )}
            <div className="profile-avatar-overlay">
              <Camera size={24} />
            </div>
          </div>
          <div className="avatar-buttons">
            <button
              className="avatar-btn"
              onClick={() => fileInputRef.current?.click()}
              disabled={isLoading}
            >
              <Camera size={16} />
              Upload
            </button>
            <button
              className="avatar-btn"
              onClick={() => setShowEmojiPicker(!showEmojiPicker)}
              disabled={isLoading}
            >
              <Smile size={16} />
              Emoji
            </button>
          </div>
          {showEmojiPicker && (
            <div className="emoji-picker">
              {AVATAR_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  className="emoji-option"
                  onClick={() => handleEmojiAvatar(emoji)}
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,image/gif"
            onChange={handleAvatarChange}
            style={{ display: 'none' }}
          />
        </div>

        <div className="profile-form">
          <div className="form-group">
            <label>Username</label>
            {isEditing ? (
              <div className="input-with-prefix">
                <span className="input-prefix">@</span>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
                  placeholder="username"
                  maxLength={30}
                />
              </div>
            ) : (
              <div className="profile-value">
                {username ? `@${username}` : <span className="empty">Not set</span>}
              </div>
            )}
          </div>

          <div className="form-group">
            <label>Display Name</label>
            {isEditing ? (
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Your display name"
                maxLength={50}
              />
            ) : (
              <div className="profile-value">
                {displayName || <span className="empty">Not set</span>}
              </div>
            )}
          </div>

          <div className="form-group">
            <label>Bio</label>
            {isEditing ? (
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="Tell something about yourself..."
                maxLength={200}
                rows={3}
              />
            ) : (
              <div className="profile-value bio">
                {bio || <span className="empty">Not set</span>}
              </div>
            )}
          </div>

          <div className="form-group">
            <label>Email</label>
            <div className="profile-value readonly">{user.email}</div>
          </div>

          {isEditing ? (
            <div className="profile-actions">
              <button className="btn btn-secondary" onClick={handleCancel} disabled={isLoading}>
                <X size={18} />
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleSave} disabled={isLoading}>
                <Check size={18} />
                {isLoading ? 'Saving...' : 'Save'}
              </button>
            </div>
          ) : (
            <button className="btn btn-primary" onClick={() => setIsEditing(true)}>
              Edit Profile
            </button>
          )}
        </div>

        {/* Encryption Status */}
        <div className="profile-section">
          <h3 className="section-title">
            <Shield size={18} />
            End-to-End Encryption
          </h3>

          <div className="encryption-status">
            <div className={`status-indicator ${isInitialized && hasKeys ? 'active' : 'inactive'}`}>
              <Lock size={16} />
              <span>
                {isInitialized && hasKeys
                  ? 'Encryption Active'
                  : 'Encryption Not Initialized'}
              </span>
            </div>

            {currentKeyId && (
              <div className="key-info">
                <Key size={14} />
                <span className="key-id">Key ID: {currentKeyId.slice(0, 8)}...</span>
              </div>
            )}

            <p className="encryption-description">
              {isInitialized && hasKeys
                ? 'Your messages are encrypted end-to-end. Only you and the recipient can read them.'
                : 'Log in again to enable end-to-end encryption for your messages.'}
            </p>
          </div>
        </div>
      </div>

      <style>{`
        .profile-page {
          min-height: 100vh;
          background: var(--bg-primary);
          padding: 20px;
        }

        .profile-container {
          max-width: 500px;
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

        .profile-loading {
          text-align: center;
          padding: 40px;
          color: var(--text-secondary);
        }

        .alert {
          padding: 12px 16px;
          border-radius: 8px;
          margin-bottom: 16px;
          font-size: 14px;
        }

        .alert-error {
          background: rgba(239, 68, 68, 0.1);
          color: #ef4444;
          border: 1px solid rgba(239, 68, 68, 0.2);
        }

        .alert-success {
          background: rgba(34, 197, 94, 0.1);
          color: #22c55e;
          border: 1px solid rgba(34, 197, 94, 0.2);
        }

        .profile-avatar-section {
          text-align: center;
          margin-bottom: 32px;
        }

        .profile-avatar {
          width: 120px;
          height: 120px;
          border-radius: 50%;
          background: var(--accent);
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto 12px;
          font-size: 48px;
          color: white;
          cursor: pointer;
          position: relative;
          overflow: hidden;
        }

        .profile-avatar img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .profile-avatar-overlay {
          position: absolute;
          inset: 0;
          background: rgba(0, 0, 0, 0.5);
          display: flex;
          align-items: center;
          justify-content: center;
          opacity: 0;
          transition: opacity 0.2s;
        }

        .profile-avatar:hover .profile-avatar-overlay {
          opacity: 1;
        }

        .emoji-avatar-large {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        }

        .emoji-display {
          font-size: 56px;
        }

        .avatar-buttons {
          display: flex;
          gap: 12px;
          justify-content: center;
          margin-top: 12px;
        }

        .avatar-btn {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 8px 16px;
          background: var(--bg-tertiary);
          border: 1px solid var(--border);
          border-radius: 8px;
          color: var(--text-primary);
          font-size: 14px;
          cursor: pointer;
          transition: all 0.2s;
        }

        .avatar-btn:hover {
          background: var(--bg-hover);
        }

        .avatar-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .emoji-picker {
          display: grid;
          grid-template-columns: repeat(8, 1fr);
          gap: 4px;
          padding: 12px;
          background: var(--bg-tertiary);
          border-radius: 12px;
          margin-top: 12px;
          max-width: 320px;
          margin-left: auto;
          margin-right: auto;
        }

        .emoji-option {
          width: 36px;
          height: 36px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 20px;
          background: transparent;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.2s;
        }

        .emoji-option:hover {
          background: var(--bg-hover);
          transform: scale(1.2);
        }

        .profile-form {
          display: flex;
          flex-direction: column;
          gap: 20px;
        }

        .form-group {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .form-group label {
          font-size: 14px;
          font-weight: 500;
          color: var(--text-secondary);
        }

        .form-group input,
        .form-group textarea {
          background: var(--bg-primary);
          border: 1px solid var(--border);
          border-radius: 8px;
          padding: 12px;
          font-size: 15px;
          color: var(--text-primary);
          width: 100%;
          resize: none;
        }

        .form-group input:focus,
        .form-group textarea:focus {
          outline: none;
          border-color: var(--accent);
        }

        .input-with-prefix {
          display: flex;
          align-items: center;
          background: var(--bg-primary);
          border: 1px solid var(--border);
          border-radius: 8px;
          overflow: hidden;
        }

        .input-prefix {
          padding: 12px;
          color: var(--text-secondary);
          background: var(--bg-tertiary);
        }

        .input-with-prefix input {
          border: none;
          border-radius: 0;
        }

        .profile-value {
          padding: 12px;
          background: var(--bg-primary);
          border-radius: 8px;
          font-size: 15px;
          color: var(--text-primary);
        }

        .profile-value.readonly {
          color: var(--text-secondary);
        }

        .profile-value.bio {
          white-space: pre-wrap;
        }

        .profile-value .empty {
          color: var(--text-secondary);
          font-style: italic;
        }

        .profile-actions {
          display: flex;
          gap: 12px;
        }

        .btn {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          padding: 12px 20px;
          border-radius: 8px;
          font-size: 15px;
          font-weight: 500;
          cursor: pointer;
          border: none;
          transition: all 0.2s;
          flex: 1;
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

        .btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .profile-section {
          margin-top: 32px;
          padding-top: 24px;
          border-top: 1px solid var(--border);
        }

        .section-title {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 16px;
          font-weight: 600;
          margin-bottom: 16px;
        }

        .encryption-status {
          background: var(--bg-primary);
          border-radius: 12px;
          padding: 16px;
        }

        .status-indicator {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 14px;
          font-weight: 500;
          margin-bottom: 8px;
        }

        .status-indicator.active {
          color: #22c55e;
        }

        .status-indicator.inactive {
          color: var(--text-secondary);
        }

        .key-info {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 12px;
          color: var(--text-secondary);
          margin-bottom: 12px;
        }

        .key-id {
          font-family: monospace;
        }

        .encryption-description {
          font-size: 13px;
          color: var(--text-secondary);
          line-height: 1.5;
        }
      `}</style>
    </div>
  )
}
