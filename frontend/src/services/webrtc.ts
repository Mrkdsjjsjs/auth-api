/**
 * WebRTC Service - Manages peer connections for audio/video calls
 */

export interface IceServer {
  urls: string | string[]
  username?: string
  credential?: string
}

export interface WebRTCConfig {
  iceServers: IceServer[]
}

type EventHandler = (event: any) => void

class WebRTCService {
  private peerConnection: RTCPeerConnection | null = null
  private localStream: MediaStream | null = null
  private remoteStream: MediaStream | null = null
  private screenStream: MediaStream | null = null
  private config: WebRTCConfig | null = null
  private eventHandlers: Map<string, EventHandler[]> = new Map()
  private isNegotiating = false
  private pendingCandidates: RTCIceCandidateInit[] = []

  /**
   * Initialize with ICE servers from backend
   */
  async init(iceServers: IceServer[]): Promise<void> {
    this.config = { iceServers }
    this.pendingCandidates = []
    this.isNegotiating = false
    console.log('[WebRTC] Initialized with ICE servers:', iceServers.length)
  }

  /**
   * Create peer connection and get local media
   */
  async createConnection(_isInitiator: boolean): Promise<void> {
    if (!this.config) {
      throw new Error('WebRTC not initialized. Call init() first.')
    }

    // Create peer connection
    this.peerConnection = new RTCPeerConnection(this.config)

    // Handle ICE candidates
    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        this.emit('icecandidate', event.candidate)
      }
    }

    // Handle connection state changes
    this.peerConnection.onconnectionstatechange = () => {
      const state = this.peerConnection?.connectionState
      console.log('[WebRTC] Connection state:', state)
      this.emit('connectionstatechange', state)

      // Try ICE restart on failure
      if (state === 'failed') {
        console.log('[WebRTC] Connection failed, attempting ICE restart...')
        this.restartIce()
      }
    }

    // Handle ICE connection state changes
    this.peerConnection.oniceconnectionstatechange = () => {
      const state = this.peerConnection?.iceConnectionState
      console.log('[WebRTC] ICE connection state:', state)

      // Try ICE restart on failure
      if (state === 'failed') {
        console.log('[WebRTC] ICE failed, attempting restart...')
        this.restartIce()
      }
    }

    // Handle signaling state changes
    this.peerConnection.onsignalingstatechange = () => {
      console.log('[WebRTC] Signaling state:', this.peerConnection?.signalingState)
      this.isNegotiating = this.peerConnection?.signalingState !== 'stable'
    }

    // Handle negotiation needed (for adding tracks mid-call)
    this.peerConnection.onnegotiationneeded = async () => {
      console.log('[WebRTC] Negotiation needed')

      // Prevent glare (simultaneous offers)
      if (this.isNegotiating) {
        console.log('[WebRTC] Already negotiating, skipping')
        return
      }

      // Whoever adds a track should trigger renegotiation
      try {
        this.isNegotiating = true
        this.emit('needsrenegotiation', null)
      } catch (error) {
        console.error('[WebRTC] Negotiation error:', error)
        this.isNegotiating = false
      }
    }

    // Handle incoming tracks (remote audio/video)
    this.peerConnection.ontrack = (event) => {
      console.log('[WebRTC] Remote track received:', event.track.kind)

      if (!this.remoteStream) {
        this.remoteStream = new MediaStream()
      }

      // Check if track already exists
      const existingTrack = this.remoteStream.getTracks().find(t => t.id === event.track.id)
      if (!existingTrack) {
        this.remoteStream.addTrack(event.track)
        console.log('[WebRTC] Track added. Total:', this.remoteStream.getTracks().length)
      }

      // Emit new stream reference
      const newStream = new MediaStream(this.remoteStream.getTracks())
      this.remoteStream = newStream
      this.emit('remotestream', newStream)
    }

    // Get local audio stream
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      })

      // Add tracks to peer connection
      this.localStream.getTracks().forEach((track) => {
        if (this.peerConnection && this.localStream) {
          this.peerConnection.addTrack(track, this.localStream)
        }
      })

      this.emit('localstream', this.localStream)
      console.log('[WebRTC] Local stream ready')
    } catch (error) {
      console.error('[WebRTC] Failed to get local stream:', error)
      throw error
    }
  }

  /**
   * Restart ICE connection
   */
  private async restartIce(): Promise<void> {
    if (!this.peerConnection) return

    try {
      const offer = await this.peerConnection.createOffer({ iceRestart: true })
      await this.peerConnection.setLocalDescription(offer)
      console.log('[WebRTC] ICE restart offer created')
      this.emit('needsrenegotiation', null)
    } catch (error) {
      console.error('[WebRTC] ICE restart failed:', error)
    }
  }

  /**
   * Create and return SDP offer
   */
  async createOffer(iceRestart = false): Promise<RTCSessionDescriptionInit> {
    if (!this.peerConnection) {
      throw new Error('Peer connection not created')
    }

    // Wait for stable state if needed
    if (this.peerConnection.signalingState !== 'stable') {
      console.log('[WebRTC] Waiting for stable state...')
      await new Promise<void>((resolve) => {
        const check = () => {
          if (this.peerConnection?.signalingState === 'stable') {
            resolve()
          } else {
            setTimeout(check, 100)
          }
        }
        setTimeout(check, 100)
      })
    }

    const offer = await this.peerConnection.createOffer({ iceRestart })
    await this.peerConnection.setLocalDescription(offer)
    console.log('[WebRTC] Offer created')
    return offer
  }

  /**
   * Create and return SDP answer
   */
  async createAnswer(): Promise<RTCSessionDescriptionInit> {
    if (!this.peerConnection) {
      throw new Error('Peer connection not created')
    }

    const answer = await this.peerConnection.createAnswer()
    await this.peerConnection.setLocalDescription(answer)
    console.log('[WebRTC] Answer created')
    return answer
  }

  /**
   * Set remote SDP (offer or answer)
   */
  async setRemoteDescription(sdp: RTCSessionDescriptionInit): Promise<void> {
    if (!this.peerConnection) {
      throw new Error('Peer connection not created')
    }

    // Handle glare - if we receive offer while we have local offer
    if (sdp.type === 'offer' && this.peerConnection.signalingState === 'have-local-offer') {
      console.log('[WebRTC] Glare detected, rolling back')
      await this.peerConnection.setLocalDescription({ type: 'rollback' })
    }

    await this.peerConnection.setRemoteDescription(new RTCSessionDescription(sdp))
    console.log('[WebRTC] Remote description set')

    // Add pending ICE candidates
    for (const candidate of this.pendingCandidates) {
      try {
        await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate))
      } catch (e) {
        console.warn('[WebRTC] Failed to add pending candidate:', e)
      }
    }
    this.pendingCandidates = []
  }

  /**
   * Add ICE candidate from remote peer
   */
  async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    if (!this.peerConnection) {
      console.warn('[WebRTC] No peer connection for ICE candidate')
      return
    }

    // Queue candidate if remote description not set yet
    if (!this.peerConnection.remoteDescription) {
      console.log('[WebRTC] Queuing ICE candidate')
      this.pendingCandidates.push(candidate)
      return
    }

    try {
      await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate))
    } catch (error) {
      console.warn('[WebRTC] Failed to add ICE candidate:', error)
    }
  }

  /**
   * Toggle microphone mute
   */
  setMuted(muted: boolean): void {
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach((track) => {
        track.enabled = !muted
      })
      console.log('[WebRTC] Muted:', muted)
    }
  }

  /**
   * Start screen sharing
   */
  async startScreenShare(): Promise<MediaStream> {
    try {
      console.log('[WebRTC] Requesting screen share...')
      this.screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      })

      if (!this.peerConnection) {
        throw new Error('No peer connection')
      }

      const videoTrack = this.screenStream.getVideoTracks()[0]
      console.log('[WebRTC] Got video track:', videoTrack.label)

      // Find existing video sender
      const videoSender = this.peerConnection
        .getSenders()
        .find((s) => s.track?.kind === 'video')

      if (videoSender) {
        // Replace existing track (no renegotiation needed)
        console.log('[WebRTC] Replacing existing video track')
        await videoSender.replaceTrack(videoTrack)
      } else {
        // Add new track (will trigger onnegotiationneeded)
        console.log('[WebRTC] Adding new video track')
        this.peerConnection.addTrack(videoTrack, this.screenStream)
      }

      // Handle when user stops screen share via browser UI
      videoTrack.onended = () => {
        console.log('[WebRTC] Video track ended')
        this.stopScreenShare()
        this.emit('screenshareended', null)
      }

      console.log('[WebRTC] Screen sharing started')
      this.emit('screenshare', this.screenStream)

      return this.screenStream
    } catch (error) {
      console.error('[WebRTC] Failed to start screen share:', error)
      throw error
    }
  }

  /**
   * Stop screen sharing
   */
  stopScreenShare(): void {
    if (this.screenStream) {
      this.screenStream.getTracks().forEach((track) => track.stop())
      this.screenStream = null
      console.log('[WebRTC] Screen sharing stopped')
    }
  }

  /**
   * Close connection and cleanup
   */
  close(): void {
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop())
      this.localStream = null
    }

    this.stopScreenShare()

    if (this.peerConnection) {
      this.peerConnection.close()
      this.peerConnection = null
    }

    this.remoteStream = null
    this.pendingCandidates = []
    this.isNegotiating = false

    console.log('[WebRTC] Connection closed')
  }

  /**
   * Get current connection state
   */
  getConnectionState(): RTCPeerConnectionState | null {
    return this.peerConnection?.connectionState || null
  }

  /**
   * Check if peer connection is ready
   */
  isReady(): boolean {
    return this.peerConnection !== null && this.localStream !== null
  }

  /**
   * Get current remote stream
   */
  getRemoteStream(): MediaStream | null {
    return this.remoteStream
  }

  /**
   * Event handling
   */
  on(event: string, handler: EventHandler): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, [])
    }
    this.eventHandlers.get(event)!.push(handler)
  }

  off(event: string, handler: EventHandler): void {
    const handlers = this.eventHandlers.get(event)
    if (handlers) {
      const index = handlers.indexOf(handler)
      if (index > -1) {
        handlers.splice(index, 1)
      }
    }
  }

  private emit(event: string, data: any): void {
    const handlers = this.eventHandlers.get(event) || []
    handlers.forEach((handler) => handler(data))
  }
}

export const webrtcService = new WebRTCService()
export default webrtcService
