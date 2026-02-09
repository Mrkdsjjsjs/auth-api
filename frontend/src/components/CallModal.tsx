import { useEffect, useRef, useState, useCallback } from 'react'
import { useCallStore } from '../store/callStore'
import { PhoneOff, Mic, MicOff, Monitor, MonitorOff, Maximize, Minimize } from 'lucide-react'
import { getStaticUrl } from '../utils/staticUrl'
import { VideoAvatar } from './VideoAvatar'

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
    remoteStream,
    localScreenStream,
  } = useCallStore()

  const audioRef = useRef<HTMLAudioElement>(null)
  const remoteVideoRef = useRef<HTMLVideoElement>(null)
  const localVideoRef = useRef<HTMLVideoElement>(null)

  const [isFullscreen, setIsFullscreen] = useState(false)
  const videoContainerRef = useRef<HTMLDivElement>(null)

  // Pinch-to-zoom state
  const [videoScale, setVideoScale] = useState(1)
  const [videoTranslate, setVideoTranslate] = useState({ x: 0, y: 0 })
  const touchStateRef = useRef<{
    initialDistance: number
    initialScale: number
    lastTouchX: number
    lastTouchY: number
    isPinching: boolean
    lastTapTime: number
  }>({
    initialDistance: 0,
    initialScale: 1,
    lastTouchX: 0,
    lastTouchY: 0,
    isPinching: false,
    lastTapTime: 0,
  })

  const displayName = remoteUserName || storeRemoteUserName || 'Unknown'
  const avatarUrl = remoteUserAvatar || storeRemoteUserAvatar
  const oderId = remoteUserId || storeRemoteUserId || 'unknown'

  // Attach remote stream to audio element whenever it changes
  useEffect(() => {
    if (audioRef.current && remoteStream) {
      console.log('[CallModal] Attaching remote stream to audio, tracks:', remoteStream.getTracks().map(t => `${t.kind}:${t.readyState}`))
      audioRef.current.srcObject = remoteStream
      audioRef.current.play().catch(() => {})
    }
  }, [remoteStream])

  // Set remote video when element mounts or stream changes
  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      const videoTracks = remoteStream.getVideoTracks()
      console.log('[CallModal] Setting remote video srcObject, video tracks:', videoTracks.length,
        videoTracks.map(t => `${t.id}:${t.readyState}:muted=${t.muted}`))
      remoteVideoRef.current.srcObject = remoteStream
      remoteVideoRef.current.play().catch(e => console.log('[CallModal] Remote video play error:', e))
    }
  }, [isRemoteScreenSharing, remoteStream])

  // Set local video when element mounts (after isScreenSharing becomes true)
  useEffect(() => {
    if (localVideoRef.current && localScreenStream) {
      console.log('[CallModal] Setting local video srcObject, video tracks:', localScreenStream.getVideoTracks().length)
      localVideoRef.current.srcObject = localScreenStream
      localVideoRef.current.play().catch(e => console.log('[CallModal] Local video play error:', e))
    }
  }, [isScreenSharing, localScreenStream])

  // Listen for fullscreen changes
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement)
    }

    document.addEventListener('fullscreenchange', handleFullscreenChange)
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange)

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange)
    }
  }, [])

  // Reset zoom when screen share changes
  useEffect(() => {
    setVideoScale(1)
    setVideoTranslate({ x: 0, y: 0 })
  }, [isRemoteScreenSharing])

  const getTouchDistance = (touches: React.TouchList) => {
    const dx = touches[0].clientX - touches[1].clientX
    const dy = touches[0].clientY - touches[1].clientY
    return Math.sqrt(dx * dx + dy * dy)
  }

  const handleVideoTouchStart = useCallback((e: React.TouchEvent) => {
    const ts = touchStateRef.current
    if (e.touches.length === 2) {
      // Pinch start
      ts.isPinching = true
      ts.initialDistance = getTouchDistance(e.touches)
      ts.initialScale = videoScale
    } else if (e.touches.length === 1) {
      // Pan start or double-tap detection
      const now = Date.now()
      if (now - ts.lastTapTime < 300) {
        // Double tap — reset zoom
        setVideoScale(1)
        setVideoTranslate({ x: 0, y: 0 })
        ts.lastTapTime = 0
        return
      }
      ts.lastTapTime = now
      ts.lastTouchX = e.touches[0].clientX
      ts.lastTouchY = e.touches[0].clientY
      ts.isPinching = false
    }
  }, [videoScale])

  const handleVideoTouchMove = useCallback((e: React.TouchEvent) => {
    e.preventDefault()
    const ts = touchStateRef.current
    if (e.touches.length === 2 && ts.isPinching) {
      // Pinch zoom
      const currentDistance = getTouchDistance(e.touches)
      const newScale = Math.min(4, Math.max(1, ts.initialScale * (currentDistance / ts.initialDistance)))
      setVideoScale(newScale)
      if (newScale === 1) {
        setVideoTranslate({ x: 0, y: 0 })
      }
    } else if (e.touches.length === 1 && !ts.isPinching && videoScale > 1) {
      // Pan when zoomed
      const dx = e.touches[0].clientX - ts.lastTouchX
      const dy = e.touches[0].clientY - ts.lastTouchY
      ts.lastTouchX = e.touches[0].clientX
      ts.lastTouchY = e.touches[0].clientY
      setVideoTranslate(prev => ({
        x: prev.x + dx,
        y: prev.y + dy,
      }))
    }
  }, [videoScale])

  const handleVideoTouchEnd = useCallback((e: React.TouchEvent) => {
    if (e.touches.length < 2) {
      touchStateRef.current.isPinching = false
    }
  }, [])

  // Toggle fullscreen for video
  const toggleFullscreen = useCallback(async () => {
    try {
      if (!document.fullscreenElement) {
        const element = videoContainerRef.current || remoteVideoRef.current
        if (element) {
          if (element.requestFullscreen) {
            await element.requestFullscreen()
          } else if ((element as any).webkitRequestFullscreen) {
            await (element as any).webkitRequestFullscreen()
          }
        }
      } else {
        if (document.exitFullscreen) {
          await document.exitFullscreen()
        } else if ((document as any).webkitExitFullscreen) {
          await (document as any).webkitExitFullscreen()
        }
      }
    } catch (e) {
      console.log('[CallModal] Fullscreen error:', e)
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
    const url = getStaticUrl(avatarUrl)
    if (url?.startsWith('emoji:')) {
      return <span className="call-avatar-emoji">{url.slice(6)}</span>
    }
    if (url?.match(/\.(mp4|webm|mov)$/i)) {
      return <VideoAvatar src={url} className="call-avatar-img" />
    }
    if (url) {
      return <img src={url} alt="" className="call-avatar-img" />
    }
    return <span className="call-avatar-emoji">{getEmojiAvatar(oderId)}</span>
  }

  const hasVideo = isScreenSharing || isRemoteScreenSharing

  return (
    <div className={`call-fullscreen ${hasVideo ? 'has-video' : ''}`}>
      {/* Video area */}
      {hasVideo && (
        <div
          className="call-video-container"
          ref={videoContainerRef}
          onTouchStart={handleVideoTouchStart}
          onTouchMove={handleVideoTouchMove}
          onTouchEnd={handleVideoTouchEnd}
          style={{ touchAction: 'none' }}
        >
          {/* Remote screen share */}
          {isRemoteScreenSharing && (
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className="call-video-main"
              onClick={toggleFullscreen}
              style={{
                transform: `scale(${videoScale}) translate(${videoTranslate.x / videoScale}px, ${videoTranslate.y / videoScale}px)`,
                transition: videoScale === 1 ? 'transform 0.2s' : 'none',
              }}
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
              onClick={!isRemoteScreenSharing ? toggleFullscreen : undefined}
            />
          )}

          {/* Fullscreen toggle button */}
          <button
            className="call-fullscreen-btn"
            onClick={toggleFullscreen}
            title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {isFullscreen ? <Minimize size={20} /> : <Maximize size={20} />}
          </button>
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
          disabled={status !== 'active' || isRemoteScreenSharing}
          title={isRemoteScreenSharing ? 'Remote user is sharing' : isScreenSharing ? 'Stop sharing' : 'Share screen'}
        >
          {isScreenSharing ? <MonitorOff size={24} /> : <Monitor size={24} />}
          <span>{isRemoteScreenSharing ? 'Viewing' : isScreenSharing ? 'Stop' : 'Share'}</span>
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
