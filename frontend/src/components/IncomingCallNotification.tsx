import { useCallStore } from '../store/callStore'
import { Phone, PhoneOff } from 'lucide-react'

// Emoji avatars based on user id hash
const AVATAR_EMOJIS = ['🦊', '🐼', '🦁', '🐯', '🐻', '🐨', '🐸', '🐵', '🦄', '🐲', '🦋', '🌸', '🌺', '🌻', '🍀', '⭐', '🌙', '🔥', '💎', '🎯', '🎨', '🎭', '🎪', '🎬', '🎤', '🎸', '🎹', '🎺', '🥁', '🎮']

function getEmojiAvatar(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash) + id.charCodeAt(i)
    hash = hash & hash
  }
  return AVATAR_EMOJIS[Math.abs(hash) % AVATAR_EMOJIS.length]
}

export default function IncomingCallNotification() {
  const {
    status,
    remoteUserName,
    remoteUserAvatar,
    remoteUserId,
    acceptCall,
    rejectCall,
  } = useCallStore()

  // Only show for incoming calls
  if (status !== 'incoming') {
    return null
  }

  const renderAvatar = () => {
    if (remoteUserAvatar?.startsWith('emoji:')) {
      return <span className="avatar-emoji">{remoteUserAvatar.slice(6)}</span>
    }
    if (remoteUserAvatar?.match(/\.(mp4|webm|mov)$/i)) {
      return <video src={remoteUserAvatar} autoPlay loop muted playsInline className="avatar-img" />
    }
    if (remoteUserAvatar) {
      return <img src={remoteUserAvatar} alt="" className="avatar-img" />
    }
    return <span className="avatar-emoji">{getEmojiAvatar(remoteUserId || 'unknown')}</span>
  }

  return (
    <div className="incoming-call-overlay">
      <div className="incoming-call-notification">
        <div className="incoming-call-content">
          <div className="incoming-call-avatar">
            {renderAvatar()}
          </div>
          <div className="incoming-call-info">
            <div className="incoming-call-label">Incoming call</div>
            <div className="incoming-call-name">{remoteUserName || 'Unknown'}</div>
          </div>
        </div>
        <div className="incoming-call-buttons">
          <button
            className="incoming-call-btn reject"
            onClick={() => rejectCall()}
            title="Reject"
          >
            <PhoneOff size={24} />
          </button>
          <button
            className="incoming-call-btn accept"
            onClick={acceptCall}
            title="Accept"
          >
            <Phone size={24} />
          </button>
        </div>
      </div>
    </div>
  )
}
