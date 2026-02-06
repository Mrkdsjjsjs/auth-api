import { useEffect, useRef, useState } from 'react'
import { useCallStore } from '../store/callStore'
import { PhoneOff, Mic, MicOff, Monitor, MonitorOff } from 'lucide-react'
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
  const remoteVideoRef = useRef<HTMLVideoElement>(null)
  const localVideoRef = useRef<HTMLVideoElement>(null)

  // Store streams in state so we can set them when video elements mount
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null)
  const [localScreenStream, setLocalScreenStream] = useState<MediaStream | null>(null)

  const displayName = remoteUserName || storeRemoteUserName || 'Unknown'
  const avatarUrl = remoteUserAvatar || storeRemoteUserAvatar
  const oderId = remoteUserId || storeRemoteUserId || 'unknown'

  // Handle remote stream (audio and video)
  useEffect(() => {
    // Check for existing stream on mount
    const existingStream = webrtcService.getRemoteStream()
    if (existingStream) {
      console.log('[CallModal] Found existing remote stream on mount')
      setRemoteStream(existingStream)
      if (audioRef.current) {
        audioRef.current.srcObject = existingStream
        audioRef.current.play().catch(console.error)
      }
    }

    const handleRemoteStream = (stream: MediaStream) => {
      console.log('[CallModal] Remote stream received, tracks:', stream.getTracks().map(t => `${t.kind}:${t.readyState}`))
      setRemoteStream(stream)

      // Audio - always available
      if (audioRef.current) {
        audioRef.current.srcObject = stream
        audioRef.current.play().catch(console.error)
      }
    }

    const handleScreenShare = (stream: MediaStream) => {
      console.log('[CallModal] Local screen share stream')
      setLocalScreenStream(stream)
    }

    const handleScreenShareEnded = () => {
      console.log('[CallModal] Local screen share ended')
      setLocalScreenStream(null)
    }

    webrtcService.on('remotestream', handleRemoteStream)
    webrtcService.on('screenshare', handleScreenShare)
    webrtcService.on('screenshareended', handleScreenShareEnded)

    return () => {
      webrtcService.off('remotestream', handleRemoteStream)
      webrtcService.off('screenshare', handleScreenShare)
      webrtcService.off('screenshareended', handleScreenShareEnded)
    }
  }, [])

  // Set remote video when element mounts (after isRemoteScreenSharing becomes true)
  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      console.log('[CallModal] Setting remote video srcObject, video tracks:', remoteStream.getVideoTracks().length)
      remoteVideoRef.current.srcObject = remoteStream
      // Explicitly call play for some browsers
      remoteVideoRef.current.play().catch(e => console.log('[CallModal] Remote video play error:', e))
    }
  }, [isRemoteScreenSharing, remoteStream])

  // Set local video when element mounts (after isScreenSharing becomes true)
  useEffect(() => {
    if (localVideoRef.current && localScreenStream) {
      console.log('[CallModal] Setting local video srcObject, video tracks:', localScreenStream.getVideoTracks().length)
      localVideoRef.current.srcObject = localScreenStream
      // Explicitly call play for some browsers
      localVideoRef.current.play().catch(e => console.log('[CallModal] Local video play error:', e))
    }
  }, [isScreenSharing, localScreenStream])

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

  const hasVideo = isScreenSharing || isRemoteScreenSharing

  return (
    <div className={`call-fullscreen ${hasVideo ? 'has-video' : ''}`}>
      {/* Video area */}
      {hasVideo && (
        <div className="call-video-container">
          {/* Remote screen share */}
          {isRemoteScreenSharing && (
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className="call-video-main"
            />
          )}

          {/* Local screen share preview */}
          {isScreenSharing && (
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className={isRemoteScreenSharing ? 'call-video-pip' : 'call-video-main'}
            />
          )}
        </div>
      )}

      {/* User info overlay */}
      <div className={`call-info-overlay ${hasVideo ? 'compact' : ''}`}>
        {!hasVideo && (
          <div className="call-avatar-large">
            {renderAvatar()}
          </div>
        )}

        <div className="call-user-info">
          <div className="call-user-name-large">{displayName}</div>
          <div className="call-status-text">
            {getStatusText()}
            {isRemoteMuted && status === 'active' && (
              <span className="call-muted-badge">
                <MicOff size={14} /> Muted
              </span>
            )}
          </div>
        </div>

        {/* Small avatar when video is showing */}
        {hasVideo && (
          <div className="call-avatar-small">
            {renderAvatar()}
          </div>
        )}
      </div>

      {/* Error message */}
      {error && (
        <div className="call-error-banner">{error}</div>
      )}

      {/* Controls */}
      <div className="call-controls-bar">
        <button
          className={`call-control-btn ${isMuted ? 'active' : ''}`}
          onClick={toggleMute}
          disabled={status !== 'active'}
          title={isMuted ? 'Unmute' : 'Mute'}
        >
          {isMuted ? <MicOff size={24} /> : <Mic size={24} />}
          <span>{isMuted ? 'Unmute' : 'Mute'}</span>
        </button>

        <button
          className={`call-control-btn ${isScreenSharing ? 'active' : ''}`}
          onClick={toggleScreenShare}
          disabled={status !== 'active'}
          title={isScreenSharing ? 'Stop sharing' : 'Share screen'}
        >
          {isScreenSharing ? <MonitorOff size={24} /> : <Monitor size={24} />}
          <span>{isScreenSharing ? 'Stop' : 'Share'}</span>
        </button>

        <button
          className="call-control-btn end-call"
          onClick={endCall}
          title="End call"
        >
          <PhoneOff size={24} />
          <span>End</span>
        </button>
      </div>

      {/* Hidden audio element */}
      <audio ref={audioRef} autoPlay />
    </div>
  )
}
