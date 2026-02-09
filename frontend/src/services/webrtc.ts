/**
 * WebRTC Service - Simple and robust
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
  private screenSender: RTCRtpSender | null = null
  private config: WebRTCConfig | null = null
  private eventHandlers: Map<string, EventHandler[]> = new Map()
  private pendingCandidates: RTCIceCandidateInit[] = []
  private hasRemoteDescription = false

  /**
   * Rebuild remoteStream from all live receiver tracks.
   * Creates a new MediaStream reference so React detects the change.
   */
  rebuildRemoteStream(): void {
    if (!this.peerConnection) return

    const tracks = this.peerConnection.getReceivers()
      .map(r => r.track)
      .filter(t => t && t.readyState === 'live')

    this.remoteStream = new MediaStream(tracks)
    console.log('[WebRTC] Remote stream rebuilt, tracks:', tracks.map(t => `${t.kind}:${t.readyState}:muted=${t.muted}`))
    this.emit('remotestream', this.remoteStream)
  }

  async init(iceServers: IceServer[]): Promise<void> {
    this.config = { iceServers }
    this.pendingCandidates = []
    this.hasRemoteDescription = false
    console.log('[WebRTC] Init with', iceServers.length, 'ICE servers')
  }

  async createConnection(): Promise<void> {
    if (!this.config) {
      throw new Error('WebRTC not initialized')
    }

    // Close existing connection if any
    if (this.peerConnection) {
      console.log('[WebRTC] Closing existing connection before creating new one')
      this.peerConnection.onicecandidate = null
      this.peerConnection.onconnectionstatechange = null
      this.peerConnection.oniceconnectionstatechange = null
      this.peerConnection.ontrack = null
      this.peerConnection.onnegotiationneeded = null
      this.peerConnection.close()
      this.peerConnection = null
    }

    // Reset streams
    this.remoteStream = null
    this.screenSender = null
    this.pendingCandidates = []
    this.hasRemoteDescription = false
    this.peerConnection = new RTCPeerConnection(this.config)

    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        this.emit('icecandidate', event.candidate)
      }
    }

    this.peerConnection.onconnectionstatechange = () => {
      const state = this.peerConnection?.connectionState
      console.log('[WebRTC] Connection:', state)
      this.emit('connectionstatechange', state)
    }

    this.peerConnection.oniceconnectionstatechange = () => {
      console.log('[WebRTC] ICE:', this.peerConnection?.iceConnectionState)
    }

    this.peerConnection.ontrack = (event) => {
      console.log('[WebRTC] Track received:', event.track.kind, 'id:', event.track.id)

      this.rebuildRemoteStream()

      // Listen for track unmute — fires when a reused transceiver reactivates
      // (e.g. screen share stop+restart reuses the same transceiver,
      //  so ontrack doesn't fire again, but onunmute does)
      event.track.onunmute = () => {
        console.log('[WebRTC] Remote track unmuted:', event.track.kind, 'id:', event.track.id)
        this.rebuildRemoteStream()
      }

      // Listen for track ending to clean up
      event.track.onended = () => {
        console.log('[WebRTC] Remote track ended:', event.track.kind)
        this.rebuildRemoteStream()
      }
    }

    // Get microphone
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      })

      this.localStream.getTracks().forEach((track) => {
        this.peerConnection!.addTrack(track, this.localStream!)
      })

      console.log('[WebRTC] Microphone ready')
    } catch (error) {
      console.error('[WebRTC] Microphone error:', error)
      throw error
    }
  }

  async createOffer(): Promise<RTCSessionDescriptionInit> {
    if (!this.peerConnection) throw new Error('No connection')

    const offer = await this.peerConnection.createOffer()
    await this.peerConnection.setLocalDescription(offer)
    console.log('[WebRTC] Offer created')
    return offer
  }

  async createAnswer(): Promise<RTCSessionDescriptionInit> {
    if (!this.peerConnection) throw new Error('No connection')

    try {
      const answer = await this.peerConnection.createAnswer()
      await this.peerConnection.setLocalDescription(answer)
      console.log('[WebRTC] Answer created')
      return answer
    } catch (error) {
      console.error('[WebRTC] Answer creation error:', error)
      throw error
    }
  }

  async setRemoteDescription(sdp: RTCSessionDescriptionInit): Promise<void> {
    if (!this.peerConnection) throw new Error('No connection')

    // Handle glare: if we get an offer while negotiating, rollback
    if (sdp.type === 'offer' && this.peerConnection.signalingState === 'have-local-offer') {
      console.log('[WebRTC] Glare detected, rolling back local description')
      await this.peerConnection.setLocalDescription({ type: 'rollback' })
    }

    await this.peerConnection.setRemoteDescription(new RTCSessionDescription(sdp))
    this.hasRemoteDescription = true
    console.log('[WebRTC] Remote SDP set, type:', sdp.type)

    // Rebuild remote stream in case tracks changed direction (screen share restart)
    this.rebuildRemoteStream()

    // Add pending ICE candidates
    if (this.pendingCandidates.length > 0) {
      console.log('[WebRTC] Adding', this.pendingCandidates.length, 'pending candidates')
      for (const candidate of this.pendingCandidates) {
        try {
          await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate))
        } catch (e) {
          // Ignore
        }
      }
      this.pendingCandidates = []
    }
  }

  async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    if (!this.peerConnection) return

    // Queue if no remote description yet
    if (!this.hasRemoteDescription) {
      this.pendingCandidates.push(candidate)
      return
    }

    try {
      await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate))
    } catch (e) {
      // Ignore
    }
  }

  setMuted(muted: boolean): void {
    this.localStream?.getAudioTracks().forEach((track) => {
      track.enabled = !muted
    })
  }

  async startScreenShare(): Promise<MediaStream> {
    console.log('[WebRTC] Starting screen share...')

    // Stop existing screen stream tracks
    if (this.screenStream) {
      this.screenStream.getTracks().forEach((t) => t.stop())
      this.screenStream = null
    }

    this.screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: false,
    })

    if (!this.peerConnection) throw new Error('No connection')

    const videoTrack = this.screenStream.getVideoTracks()[0]

    if (this.screenSender) {
      // Reuse existing sender — just swap the track, no renegotiation needed
      await this.screenSender.replaceTrack(videoTrack)
      console.log('[WebRTC] Video track replaced on existing sender (no renegotiation)')
    } else {
      // First time — addTrack creates a transceiver, needs renegotiation
      this.screenSender = this.peerConnection.addTrack(videoTrack, this.screenStream)
      console.log('[WebRTC] Video track added to connection (first time, will renegotiate)')
      this.emit('needsrenegotiation', null)
    }

    videoTrack.onended = () => {
      console.log('[WebRTC] Screen share ended by user')
      this.doStopScreenShare()
      this.emit('screenshareended', null)
    }

    this.emit('screenshare', this.screenStream)
    return this.screenStream
  }

  private doStopScreenShare(): void {
    // Replace track with null — keeps sender alive for reuse, no renegotiation
    if (this.screenSender) {
      this.screenSender.replaceTrack(null).catch((e) => {
        console.warn('[WebRTC] Error replacing track with null:', e)
      })
      // Keep screenSender reference for reuse on next startScreenShare
    }

    // Stop all tracks in the screen stream
    if (this.screenStream) {
      this.screenStream.getTracks().forEach((t) => t.stop())
      this.screenStream = null
    }
  }

  stopScreenShare(): void {
    this.doStopScreenShare()
    // No renegotiation needed — replaceTrack(null) doesn't change SDP
  }

  async restartIce(): Promise<RTCSessionDescriptionInit | null> {
    if (!this.peerConnection) return null

    console.log('[WebRTC] Restarting ICE...')
    try {
      const offer = await this.peerConnection.createOffer({ iceRestart: true })
      await this.peerConnection.setLocalDescription(offer)
      console.log('[WebRTC] ICE restart offer created')
      return offer
    } catch (error) {
      console.error('[WebRTC] ICE restart error:', error)
      return null
    }
  }

  close(): void {
    this.localStream?.getTracks().forEach((t) => t.stop())
    this.localStream = null

    // Stop screen share tracks directly (don't use doStopScreenShare — PC is closing)
    if (this.screenStream) {
      this.screenStream.getTracks().forEach((t) => t.stop())
      this.screenStream = null
    }
    this.screenSender = null

    if (this.peerConnection) {
      this.peerConnection.onicecandidate = null
      this.peerConnection.onconnectionstatechange = null
      this.peerConnection.oniceconnectionstatechange = null
      this.peerConnection.ontrack = null
      this.peerConnection.onnegotiationneeded = null
      this.peerConnection.close()
      this.peerConnection = null
    }

    this.remoteStream = null
    this.pendingCandidates = []
    this.hasRemoteDescription = false

    console.log('[WebRTC] Closed')
  }

  getConnectionState(): RTCPeerConnectionState | null {
    return this.peerConnection?.connectionState || null
  }

  getSignalingState(): RTCSignalingState | null {
    return this.peerConnection?.signalingState || null
  }

  isReady(): boolean {
    return this.peerConnection !== null && this.localStream !== null
  }

  getRemoteStream(): MediaStream | null {
    return this.remoteStream
  }

  on(event: string, handler: EventHandler): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, [])
    }
    this.eventHandlers.get(event)!.push(handler)
  }

  off(event: string, handler: EventHandler): void {
    const handlers = this.eventHandlers.get(event)
    if (handlers) {
      const idx = handlers.indexOf(handler)
      if (idx > -1) handlers.splice(idx, 1)
    }
  }

  offAll(): void {
    this.eventHandlers.clear()
  }

  private emit(event: string, data: any): void {
    this.eventHandlers.get(event)?.forEach((h) => h(data))
  }
}

export const webrtcService = new WebRTCService()
export default webrtcService