import { useCallStore } from '../store/callStore'
import { Phone, PhoneOff } from 'lucide-react'

export default function IncomingCallNotification() {
  const {
    status,
    remoteUserName,
    acceptCall,
    rejectCall,
  } = useCallStore()

  // Only show for incoming calls
  if (status !== 'incoming') {
    return null
  }

  return (
    <div className="incoming-call-notification">
      <div className="incoming-call-content">
        <div className="incoming-call-avatar">
          <span>{(remoteUserName || 'U').charAt(0).toUpperCase()}</span>
        </div>
        <div className="incoming-call-info">
          <div className="incoming-call-name">{remoteUserName || 'Unknown'}</div>
          <div className="incoming-call-label">Incoming call...</div>
        </div>
      </div>
      <div className="incoming-call-buttons">
        <button
          className="incoming-call-btn reject"
          onClick={() => rejectCall()}
          title="Reject"
        >
          <PhoneOff size={20} />
        </button>
        <button
          className="incoming-call-btn accept"
          onClick={acceptCall}
          title="Accept"
        >
          <Phone size={20} />
        </button>
      </div>
    </div>
  )
}
