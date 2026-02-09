import { create } from 'zustand'
import { callsApi } from '../services/api'
import wsService from '../services/websocket'
import webrtcService from '../services/webrtc'
import callSoundService from '../services/callSound'

export type CallStatus =
  | 'idle'
  | 'initiating'
  | 'ringing'
  | 'incoming'
  | 'connecting'
  | 'active'
  | 'ended'

interface CallState {
  status: CallStatus
  callId: string | null
  chatId: string | null
  remoteUserId: string | null
  remoteUserName: string | null
  remoteUserAvatar: string | null
  isInitiator: boolean
  isMuted: boolean
  isRemoteMuted: boolean
  isScreenSharing: boolean
  isRemoteScreenSharing: boolean
  callDuration: number
  error: string | null

  initiateCall: (chatId: string, calleeId: string) => Promise<void>
  acceptCall: () => Promise<void>
  rejectCall: (reason?: string) => void
  endCall: () => void
  toggleMute: () => void
  toggleScreenShare: () => Promise<void>
  setupCallHandlers: () => void
  reset: () => void
}

let durationInterval: NodeJS.Timeout | null = null
let reconnectTimeout: NodeJS.Timeout | null = null

// Guards against duplicate WS messages causing concurrent SDP operations
let isProcessingOffer = false
let isProcessingAnswer = false

function clearTimers() {
  if (durationInterval) {
    clearInterval(durationInterval)
    durationInterval = null
  }
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout)
    reconnectTimeout = null
  }
}

export const useCallStore = create<CallState>((set, get) => ({
  status: 'idle',
  callId: null,
  chatId: null,
  remoteUserId: null,
  remoteUserName: null,
  remoteUserAvatar: null,
  isInitiator: false,
  isMuted: false,
  isRemoteMuted: false,
  isScreenSharing: false,
  isRemoteScreenSharing: false,
  callDuration: 0,
  error: null,

  initiateCall: async (chatId: string, calleeId: string) => {
    try {
      set({ status: 'initiating', chatId, remoteUserId: calleeId, isInitiator: true, error: null })

      const { data } = await callsApi.getIceServers()
      await webrtcService.init(data.ice_servers)
      await webrtcService.createConnection()

      const { data: callData } = await callsApi.initiate(chatId, calleeId)
      set({ callId: callData.call_id })

      callSoundService.startDialTone()
      set({ status: 'ringing' })
    } catch (error: any) {
      console.error('[Call] Failed to initiate:', error)
      const message = error.response?.data?.detail || error.message || 'Failed to start call'
      set({ status: 'idle', error: message })
      callSoundService.stopDialTone()
    }
  },

  acceptCall: async () => {
    const { callId } = get()
    if (!callId) return

    try {
      set({ status: 'connecting' })
      callSoundService.stopRingtone()

      const { data } = await callsApi.getIceServers()
      await webrtcService.init(data.ice_servers)
      await webrtcService.createConnection()

      await callsApi.accept(callId)
      callSoundService.playAccepted()
    } catch (error: any) {
      console.error('[Call] Failed to accept:', error)
      set({ status: 'idle', error: error.message || 'Failed to accept call' })
      get().rejectCall('failed')
    }
  },

  rejectCall: (reason = 'rejected') => {
    const { callId } = get()
    if (callId) {
      callsApi.reject(callId, reason).catch((e) => console.error('[Call] reject error:', e))
    }
    callSoundService.stopRingtone()
    callSoundService.playEnded()
    webrtcService.close()
    clearTimers()
    get().reset()
  },

  endCall: () => {
    const { callId } = get()
    if (callId) {
      callsApi.end(callId).catch((e) => console.error('[Call] end error:', e))
    }
    callSoundService.stopDialTone()
    callSoundService.stopRingtone()
    callSoundService.playEnded()
    webrtcService.close()
    clearTimers()
    get().reset()
  },

  toggleMute: () => {
    const { isMuted, callId } = get()
    const newMuted = !isMuted
    webrtcService.setMuted(newMuted)
    set({ isMuted: newMuted })
    if (callId) {
      callsApi.mute(callId, newMuted).catch((e) => console.error('[Call] mute error:', e))
    }
  },

  toggleScreenShare: async () => {
    const { isScreenSharing, callId } = get()

    try {
      if (isScreenSharing) {
        webrtcService.stopScreenShare()
        set({ isScreenSharing: false })
        if (callId) {
          callsApi.screenShare(callId, false).catch((e) => console.error('[Call] screen-share error:', e))
        }
      } else {
        await webrtcService.startScreenShare()
        set({ isScreenSharing: true })
        if (callId) {
          callsApi.screenShare(callId, true).catch((e) => console.error('[Call] screen-share error:', e))
        }
      }
    } catch (error) {
      console.error('[Call] Screen share error:', error)
    }
  },

  setupCallHandlers: () => {
    // Clear any previous WebRTC event handlers to prevent accumulation
    webrtcService.offAll()
    // Reset signaling guards
    isProcessingOffer = false
    isProcessingAnswer = false

    // Incoming call
    wsService.on('call_incoming', (data) => {
      const { status } = get()
      if (status !== 'idle') return

      set({
        status: 'incoming',
        callId: data.call_id,
        chatId: data.chat_id,
        remoteUserId: data.caller_id,
        remoteUserName: data.caller_name,
        remoteUserAvatar: data.caller_avatar || null,
        isInitiator: false,
      })
      callSoundService.startRingtone()
    }, true)

    // Call accepted — only process once (guard against duplicate WS)
    wsService.on('call_accepted', async (data) => {
      const { isInitiator, status } = get()
      // Strict guard: only from 'ringing' state (set() to 'connecting' is synchronous)
      if (!isInitiator || status !== 'ringing') return

      set({ status: 'connecting' })
      callSoundService.stopDialTone()
      callSoundService.playAccepted()

      try {
        const offer = await webrtcService.createOffer()
        await callsApi.offer(data.call_id, offer)
      } catch (error) {
        console.error('[Call] Failed to create offer:', error)
      }
    }, true)

    // Call rejected
    wsService.on('call_rejected', (data) => {
      callSoundService.stopDialTone()
      callSoundService.playEnded()
      webrtcService.close()
      clearTimers()
      set({ error: data.reason || 'Call rejected' })
      setTimeout(() => get().reset(), 2000)
    }, true)

    // Call accepted on another device
    wsService.on('call_accepted_on_other_device', () => {
      const { status } = get()
      if (status === 'incoming') {
        callSoundService.stopRingtone()
        set({ status: 'idle', error: 'Answered on another device' })
        setTimeout(() => get().reset(), 2000)
      }
    }, true)

    // Call ended
    wsService.on('call_ended', () => {
      callSoundService.stopDialTone()
      callSoundService.stopRingtone()
      callSoundService.playEnded()
      webrtcService.close()
      clearTimers()
      get().reset()
    }, true)

    // Offer received (initial or renegotiation) — guarded against duplicates
    wsService.on('call_offer', async (data) => {
      const { callId } = get()

      if (!callId || callId !== data.call_id) return

      // Prevent concurrent offer processing (duplicate WS messages)
      if (isProcessingOffer) {
        console.log('[Call] Skipping duplicate offer')
        return
      }
      isProcessingOffer = true

      // Wait for connection
      let tries = 0
      while (!webrtcService.isReady() && tries < 30) {
        await new Promise((r) => setTimeout(r, 100))
        tries++
      }

      if (!webrtcService.isReady()) {
        console.log('[Call] WebRTC not ready after waiting')
        isProcessingOffer = false
        return
      }

      try {
        await webrtcService.setRemoteDescription(data.sdp)
        const answer = await webrtcService.createAnswer()
        await callsApi.answer(data.call_id, answer)
      } catch (error) {
        console.error('[Call] Offer handling error:', error)
      } finally {
        isProcessingOffer = false
      }
    }, true)

    // Answer received — guarded against duplicates
    wsService.on('call_answer', async (data) => {
      const { callId } = get()

      if (!callId || callId !== data.call_id) return

      // Prevent concurrent answer processing (duplicate WS messages)
      if (isProcessingAnswer) {
        console.log('[Call] Skipping duplicate answer')
        return
      }

      // Only process answer when we're waiting for one
      const sigState = webrtcService.getSignalingState()
      if (sigState !== 'have-local-offer') {
        console.log('[Call] Ignoring answer - signaling state:', sigState)
        return
      }

      isProcessingAnswer = true
      try {
        await webrtcService.setRemoteDescription(data.sdp)
        console.log('[Call] Remote description set successfully')
      } catch (error: any) {
        if (!error?.message?.includes('stable')) {
          console.error('[Call] Answer handling error:', error)
        }
      } finally {
        isProcessingAnswer = false
      }
    }, true)

    // ICE candidate
    wsService.on('call_ice_candidate', async (data) => {
      const { callId } = get()
      if (!callId || callId !== data.call_id) return
      if (data.candidate) {
        await webrtcService.addIceCandidate(data.candidate)
      }
    }, true)

    // Mute status
    wsService.on('call_mute', (data) => {
      set({ isRemoteMuted: data.is_muted })
    }, true)

    // Screen share status
    wsService.on('call_screen_share', (data) => {
      set({ isRemoteScreenSharing: data.is_sharing })
    }, true)

    // Call error
    wsService.on('call_error', (data) => {
      console.error('[Call] Error:', data.error)
      callSoundService.stopDialTone()
      callSoundService.stopRingtone()
      webrtcService.close()
      clearTimers()
      set({ status: 'ended', error: data.error })
      setTimeout(() => get().reset(), 3000)
    }, true)

    // WebRTC: ICE candidate
    webrtcService.on('icecandidate', (candidate) => {
      const { callId } = get()
      if (callId) {
        callsApi.iceCandidate(callId, candidate).catch((e) => console.error('[Call] ice-candidate error:', e))
      }
    })

    // WebRTC: Connection state
    webrtcService.on('connectionstatechange', (state) => {
      const { status, callId } = get()

      if (state === 'connected') {
        // Clear any reconnect timeout
        if (reconnectTimeout) {
          clearTimeout(reconnectTimeout)
          reconnectTimeout = null
        }

        set({ status: 'active' })
        if (!durationInterval) {
          durationInterval = setInterval(() => {
            set((s) => ({ callDuration: s.callDuration + 1 }))
          }, 1000)
        }
      } else if (state === 'disconnected' && status === 'active') {
        // Connection temporarily lost - try ICE restart after a short delay
        console.log('[Call] Connection disconnected, will attempt ICE restart...')
        if (reconnectTimeout) clearTimeout(reconnectTimeout)
        reconnectTimeout = setTimeout(async () => {
          const currentState = webrtcService.getConnectionState()
          if (currentState === 'disconnected' || currentState === 'failed') {
            console.log('[Call] Attempting ICE restart...')
            const offer = await webrtcService.restartIce()
            if (offer && callId) {
              callsApi.offer(callId, offer).catch((e) => console.error('[Call] ice-restart offer error:', e))
            }
          }
        }, 2000)
      } else if (state === 'failed' && status === 'active') {
        // Connection failed - attempt ICE restart immediately
        console.log('[Call] Connection failed, attempting ICE restart...')
        ;(async () => {
          const offer = await webrtcService.restartIce()
          const currentCallId = get().callId
          if (offer && currentCallId) {
            callsApi.offer(currentCallId, offer).catch((e) => console.error('[Call] ice-restart offer error:', e))
          } else {
            // ICE restart failed, end the call
            console.log('[Call] ICE restart failed, ending call')
            get().endCall()
          }
        })()
      }
    })

    // WebRTC: Renegotiation (for screen share)
    webrtcService.on('needsrenegotiation', async () => {
      const { callId } = get()
      if (!callId) return

      try {
        const offer = await webrtcService.createOffer()
        await callsApi.offer(callId, offer)
      } catch (error) {
        console.error('[Call] Renegotiation error:', error)
      }
    })

    // WebRTC: Screen share ended (by user clicking browser's stop button)
    webrtcService.on('screenshareended', () => {
      const { callId } = get()
      set({ isScreenSharing: false })
      if (callId) {
        callsApi.screenShare(callId, false).catch((e) => console.error('[Call] screen-share error:', e))
      }
    })
  },

  reset: () => {
    set({
      status: 'idle',
      callId: null,
      chatId: null,
      remoteUserId: null,
      remoteUserName: null,
      remoteUserAvatar: null,
      isInitiator: false,
      isMuted: false,
      isRemoteMuted: false,
      isScreenSharing: false,
      isRemoteScreenSharing: false,
      callDuration: 0,
      error: null,
    })
  },
}))
