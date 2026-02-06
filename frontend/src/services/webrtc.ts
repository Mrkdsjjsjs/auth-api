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
  private config: WebRTCConfig | null = null
  private eventHandlers: Map<string, EventHandler[]> = new Map()

  async init(iceServers: IceServer[]): Promise<void> {
    this.config = { iceServers }
    console.log('[WebRTC] Init with', iceServers.length, 'ICE servers')
  }

  async createConnection(): Promise<void> {
    if (!this.config) {
      throw new Error('WebRTC not initialized')
    }

    this.peerConnection = new RTCPeerConnection(this.config)

    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        this.emit('icecandidate', event.candidate)
      }
    }

    this.peerConnection.onconnectionstatechange = () => {
      console.log('[WebRTC] Connection:', this.peerConnection?.connectionState)
      this.emit('connectionstatechange', this.peerConnection?.connectionState)
    }

    this.peerConnection.oniceconnectionstatechange = () => {
      console.log('[WebRTC] ICE:', this.peerConnection?.iceConnectionState)
    }

    this.peerConnection.ontrack = (event) => {
      console.log('[WebRTC] Track received:', event.track.kind)

      if (!this.remoteStream) {
        this.remoteStream = new MediaStream()
      }

      // Add track if not exists
      const exists = this.remoteStream.getTracks().some(t => t.id === event.track.id)
      if (!exists) {
        this.remoteStream.addTrack(event.track)
      }

      this.emit('remotestream', this.remoteStream)
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

    const answer = await this.peerConnection.createAnswer()
    await this.peerConnection.setLocalDescription(answer)
    console.log('[WebRTC] Answer created')
    return answer
  }

  async setRemoteDescription(sdp: RTCSessionDescriptionInit): Promise<void> {
    if (!this.peerConnection) throw new Error('No connection')

    await this.peerConnection.setRemoteDescription(new RTCSessionDescription(sdp))
    console.log('[WebRTC] Remote SDP set')
  }

  async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    if (!this.peerConnection) return

    try {
      await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate))
    } catch (e) {
      // Ignore ICE errors
    }
  }

  setMuted(muted: boolean): void {
    this.localStream?.getAudioTracks().forEach((track) => {
      track.enabled = !muted
    })
  }

  async startScreenShare(): Promise<MediaStream> {
    console.log('[WebRTC] Starting screen share...')

    this.screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: false,
    })

    if (!this.peerConnection) throw new Error('No connection')

    const videoTrack = this.screenStream.getVideoTracks()[0]

    // Add video track
    this.peerConnection.addTrack(videoTrack, this.screenStream)
    console.log('[WebRTC] Video track added')

    videoTrack.onended = () => {
      console.log('[WebRTC] Screen share ended by user')
      this.stopScreenShare()
      this.emit('screenshareended', null)
    }

    this.emit('screenshare', this.screenStream)
    this.emit('needsrenegotiation', null)

    return this.screenStream
  }

  stopScreenShare(): void {
    if (this.screenStream) {
      this.screenStream.getTracks().forEach((t) => t.stop())
      this.screenStream = null
    }
  }

  close(): void {
    this.localStream?.getTracks().forEach((t) => t.stop())
    this.localStream = null

    this.stopScreenShare()

    this.peerConnection?.close()
    this.peerConnection = null

    this.remoteStream = null

    console.log('[WebRTC] Closed')
  }

  getConnectionState(): RTCPeerConnectionState | null {
    return this.peerConnection?.connectionState || null
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

  private emit(event: string, data: any): void {
    this.eventHandlers.get(event)?.forEach((h) => h(data))
  }
}

export const webrtcService = new WebRTCService()
export default webrtcService
