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

  /**
   * Initialize with ICE servers from backend
   */
  async init(iceServers: IceServer[]): Promise<void> {
    this.config = { iceServers }
    console.log('[WebRTC] Initialized with ICE servers:', iceServers)
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
      console.log('[WebRTC] Connection state:', this.peerConnection?.connectionState)
      this.emit('connectionstatechange', this.peerConnection?.connectionState)
    }

    // Handle ICE connection state changes
    this.peerConnection.oniceconnectionstatechange = () => {
      console.log('[WebRTC] ICE connection state:', this.peerConnection?.iceConnectionState)
      this.emit('iceconnectionstatechange', this.peerConnection?.iceConnectionState)
    }

    // Handle incoming tracks (remote audio/video)
    this.peerConnection.ontrack = (event) => {
      console.log('[WebRTC] Remote track received:', event.track.kind, 'id:', event.track.id, 'readyState:', event.track.readyState)

      // Create a new MediaStream with all tracks to ensure React detects the change
      if (!this.remoteStream) {
        this.remoteStream = new MediaStream()
      }

      // Check if track already exists
      const existingTrack = this.remoteStream.getTracks().find(t => t.id === event.track.id)
      if (!existingTrack) {
        this.remoteStream.addTrack(event.track)
        console.log('[WebRTC] Track added to remote stream. Total tracks:', this.remoteStream.getTracks().length)
      } else {
        console.log('[WebRTC] Track already exists in remote stream')
      }

      // Create new MediaStream reference so React can detect the change
      const newStream = new MediaStream(this.remoteStream.getTracks())
      this.remoteStream = newStream

      this.emit('remotestream', newStream)
    }

    // Get local audio stream
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false, // Audio only for now
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
   * Create and return SDP offer
   */
  async createOffer(): Promise<RTCSessionDescriptionInit> {
    if (!this.peerConnection) {
      throw new Error('Peer connection not created')
    }

    const offer = await this.peerConnection.createOffer()
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

    await this.peerConnection.setRemoteDescription(new RTCSessionDescription(sdp))
    console.log('[WebRTC] Remote description set')
  }

  /**
   * Add ICE candidate from remote peer
   */
  async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    if (!this.peerConnection) {
      console.warn('[WebRTC] No peer connection for ICE candidate')
      return
    }

    try {
      await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate))
      console.log('[WebRTC] ICE candidate added')
    } catch (error) {
      console.error('[WebRTC] Failed to add ICE candidate:', error)
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
      console.log('[WebRTC] Got video track:', videoTrack.label, 'readyState:', videoTrack.readyState)

      // Check if we already have a video sender
      const videoSender = this.peerConnection
        .getSenders()
        .find((s) => s.track?.kind === 'video')

      if (videoSender) {
        console.log('[WebRTC] Replacing existing video track')
        await videoSender.replaceTrack(videoTrack)
      } else {
        console.log('[WebRTC] Adding new video track')
        this.peerConnection.addTrack(videoTrack, this.screenStream)
      }

      // Handle when user stops screen share via browser UI
      videoTrack.onended = () => {
        console.log('[WebRTC] Video track ended by user/browser')
        this.stopScreenShare()
        this.emit('screenshareended', null)
      }

      console.log('[WebRTC] Screen sharing started, emitting events')
      this.emit('screenshare', this.screenStream)

      // Trigger renegotiation only if we added a new track
      if (!videoSender) {
        console.log('[WebRTC] Triggering renegotiation')
        this.emit('needsrenegotiation', null)
      }

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
    // Stop local stream
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop())
      this.localStream = null
    }

    // Stop screen share
    this.stopScreenShare()

    // Close peer connection
    if (this.peerConnection) {
      this.peerConnection.close()
      this.peerConnection = null
    }

    // Clear remote stream
    this.remoteStream = null

    console.log('[WebRTC] Connection closed')
  }

  /**
   * Get current connection state
   */
  getConnectionState(): RTCPeerConnectionState | null {
    return this.peerConnection?.connectionState || null
  }

  /**
   * Check if peer connection is ready to handle offers/answers
   */
  isReady(): boolean {
    return this.peerConnection !== null && this.localStream !== null
  }

  /**
   * Get current remote stream (useful for getting stream when component mounts)
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
