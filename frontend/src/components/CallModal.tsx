import { useEffect, useRef } from 'react'
import { useCallStore } from '../store/callStore'
import { PhoneOff, Mic, MicOff, Monitor } from 'lucide-react'
import webrtcService from '../services/webrtc'

// Format seconds to MM:SS
function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
}

interface CallModalProps {
  remoteUserName?: string
}

export default function CallModal({ remoteUserName }: CallModalProps) {
  const {
    status,
    remoteUserName: storeRemoteUserName,
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

  // Don't render if no active call
  if (status === 'idle') {
    return null
  }

  const getStatusText = () => {
    switch (status) {
      case 'initiating':
        return 'Starting call...'
      case 'ringing':
        return 'Ringing...'
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

  return (
    <div className="call-modal-overlay">
      <div className="call-modal">
        <div className="call-modal-content">
          {/* User Avatar */}
          <div className="call-avatar">
            <span className="call-avatar-emoji">
              {displayName.charAt(0).toUpperCase()}
            </span>
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
