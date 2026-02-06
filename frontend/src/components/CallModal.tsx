import { useEffect, useRef } from 'react'
import { useCallStore } from '../store/callStore'
import { PhoneOff, Mic, MicOff, Monitor } from 'lucide-react'
import webrtcService from '../services/webrtc'

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

// Format seconds to MM:SS
function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
}

interface CallModalProps {
  remoteUserName?: string
  remoteUserAvatar?: string
  remoteUserId?: string
}

export default function CallModal({ remoteUserName, remoteUserAvatar, remoteUserId }: CallModalProps) {
  const {
    status,
    remoteUserName: storeRemoteUserName,
    remoteUserAvatar: storeRemoteUserAvatar,
    remoteUserId: storeRemoteUserId,
    isMuted,
    isRemoteMuted,
    isScreenSharing,
    isRemoteScreenSharing,
    callDuration,
    error,
    endCall,
    toggleMute,
    toggleScreenShare,
  } = useCallStore()

  const audioRef = useRef<HTMLAudioElement>(null)
  const displayName = remoteUserName || storeRemoteUserName || 'Unknown'
  const avatarUrl = remoteUserAvatar || storeRemoteUserAvatar
  const oderId = remoteUserId || storeRemoteUserId || 'unknown'

  // Handle remote stream
  useEffect(() => {
    const handleRemoteStream = (stream: MediaStream) => {
      if (audioRef.current) {
        audioRef.current.srcObject = stream
        audioRef.current.play().catch(console.error)
      }
    }

    webrtcService.on('remotestream', handleRemoteStream)

    return () => {
      webrtcService.off('remotestream', handleRemoteStream)
    }
  }, [])

  // Don't render for idle or incoming (incoming has its own notification)
  if (status === 'idle' || status === 'incoming') {
    return null
  }

  const getStatusText = () => {
    switch (status) {
      case 'initiating':
        return 'Starting call...'
      case 'ringing':
        return 'Calling...'
      case 'connecting':
        return 'Connecting...'
      case 'active':
        return formatDuration(callDuration)
      case 'ended':
        return error || 'Call ended'
      default:
        return ''
    }
  }

  const renderAvatar = () => {
    if (avatarUrl?.startsWith('emoji:')) {
      return <span className="call-avatar-emoji">{avatarUrl.slice(6)}</span>
    }
    if (avatarUrl?.match(/\.(mp4|webm|mov)$/i)) {
      return <video src={avatarUrl} autoPlay loop muted playsInline className="call-avatar-img" />
    }
    if (avatarUrl) {
      return <img src={avatarUrl} alt="" className="call-avatar-img" />
    }
    return <span className="call-avatar-emoji">{getEmojiAvatar(oderId)}</span>
  }

  return (
    <div className="call-modal-overlay">
      <div className="call-modal">
        <div className="call-modal-content">
          {/* User Avatar */}
          <div className="call-avatar">
            {renderAvatar()}
          </div>

          {/* User Name */}
          <div className="call-user-name">{displayName}</div>

          {/* Status */}
          <div className="call-status">
            {getStatusText()}
            {isRemoteMuted && status === 'active' && (
              <span className="call-remote-muted">
                <MicOff size={14} /> Muted
              </span>
            )}
          </div>

          {/* Screen share indicator */}
          {isRemoteScreenSharing && (
            <div className="call-screen-share-indicator">
              <Monitor size={16} /> Screen sharing
            </div>
          )}

          {/* Error message */}
          {error && (
            <div className="call-error">{error}</div>
          )}
        </div>

        {/* Controls */}
        <div className="call-controls">
          {/* Mute button */}
          <button
            className={`call-btn ${isMuted ? 'active' : ''}`}
            onClick={toggleMute}
            disabled={status !== 'active'}
            title={isMuted ? 'Unmute' : 'Mute'}
          >
            {isMuted ? <MicOff size={24} /> : <Mic size={24} />}
          </button>

          {/* Screen share button */}
          <button
            className={`call-btn ${isScreenSharing ? 'active' : ''}`}
            onClick={toggleScreenShare}
            disabled={status !== 'active'}
            title={isScreenSharing ? 'Stop sharing' : 'Share screen'}
          >
            <Monitor size={24} />
          </button>

          {/* End call button */}
          <button
            className="call-btn end-call"
            onClick={endCall}
            title="End call"
          >
            <PhoneOff size={24} />
          </button>
        </div>

        {/* Hidden audio element for remote stream */}
        <audio ref={audioRef} autoPlay />
      </div>
    </div>
  )
}
