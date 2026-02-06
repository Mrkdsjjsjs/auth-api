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

      wsService.send('call_initiate', {
        chat_id: chatId,
        callee_id: calleeId,
      })

      callSoundService.startDialTone()
      set({ status: 'ringing' })
    } catch (error: any) {
      console.error('[Call] Failed to initiate:', error)
      set({ status: 'idle', error: error.message || 'Failed to start call' })
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

      wsService.send('call_accept', { call_id: callId })
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
      wsService.send('call_reject', { call_id: callId, reason })
    }
    callSoundService.stopRingtone()
    callSoundService.playEnded()
    webrtcService.close()
    get().reset()
  },

  endCall: () => {
    const { callId } = get()
    if (callId) {
      wsService.send('call_end', { call_id: callId })
    }
    callSoundService.stopDialTone()
    callSoundService.stopRingtone()
    callSoundService.playEnded()
    webrtcService.close()

    if (durationInterval) {
      clearInterval(durationInterval)
      durationInterval = null
    }
    get().reset()
  },

  toggleMute: () => {
    const { isMuted, callId } = get()
    const newMuted = !isMuted
    webrtcService.setMuted(newMuted)
    set({ isMuted: newMuted })
    if (callId) {
      wsService.send('call_mute', { call_id: callId, is_muted: newMuted })
    }
  },

  toggleScreenShare: async () => {
    const { isScreenSharing, callId } = get()

    try {
      if (isScreenSharing) {
        webrtcService.stopScreenShare()
        set({ isScreenSharing: false })
        if (callId) {
          wsService.send('call_screen_share', { call_id: callId, is_sharing: false })
        }
      } else {
        await webrtcService.startScreenShare()
        set({ isScreenSharing: true })
        if (callId) {
          wsService.send('call_screen_share', { call_id: callId, is_sharing: true })
        }
      }
    } catch (error) {
      console.error('[Call] Screen share error:', error)
    }
  },

  setupCallHandlers: () => {
    // Call initiated
    wsService.on('call_initiated', (data) => {
      const { status } = get()
      if (status === 'initiating' || status === 'ringing') {
        set({ callId: data.call_id })
      }
    }, true)

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

    // Call accepted
    wsService.on('call_accepted', async (data) => {
      const { isInitiator, status } = get()
      if (!isInitiator || status === 'active') return

      set({ status: 'connecting' })
      callSoundService.stopDialTone()
      callSoundService.playAccepted()

      try {
        const offer = await webrtcService.createOffer()
        wsService.send('call_offer', { call_id: data.call_id, sdp: offer })
      } catch (error) {
        console.error('[Call] Failed to create offer:', error)
      }
    }, true)

    // Call rejected
    wsService.on('call_rejected', (data) => {
      callSoundService.stopDialTone()
      callSoundService.playEnded()
      webrtcService.close()
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

      if (durationInterval) {
        clearInterval(durationInterval)
        durationInterval = null
      }
      get().reset()
    }, true)

    // Offer received
    wsService.on('call_offer', async (data) => {
      const { callId } = get()
      if (!callId || callId !== data.call_id) return

      // Wait for connection
      let tries = 0
      while (!webrtcService.isReady() && tries < 30) {
        await new Promise((r) => setTimeout(r, 100))
        tries++
      }

      if (!webrtcService.isReady()) return

      try {
        await webrtcService.setRemoteDescription(data.sdp)
        const answer = await webrtcService.createAnswer()
        wsService.send('call_answer', { call_id: data.call_id, sdp: answer })
      } catch (error) {
        console.error('[Call] Offer handling error:', error)
      }
    }, true)

    // Answer received
    wsService.on('call_answer', async (data) => {
      const { callId, isInitiator } = get()
      if (!callId || callId !== data.call_id || !isInitiator) return

      try {
        await webrtcService.setRemoteDescription(data.sdp)
      } catch (error: any) {
        // Ignore duplicate answer errors
        if (!error?.message?.includes('stable')) {
          console.error('[Call] Answer handling error:', error)
        }
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
      set({ status: 'ended', error: data.error })
      setTimeout(() => get().reset(), 3000)
    }, true)

    // WebRTC: ICE candidate
    webrtcService.on('icecandidate', (candidate) => {
      const { callId } = get()
      if (callId) {
        wsService.send('call_ice_candidate', { call_id: callId, candidate })
      }
    })

    // WebRTC: Connection state
    webrtcService.on('connectionstatechange', (state) => {
      if (state === 'connected') {
        set({ status: 'active' })
        if (!durationInterval) {
          durationInterval = setInterval(() => {
            set((s) => ({ callDuration: s.callDuration + 1 }))
          }, 1000)
        }
      }
    })

    // WebRTC: Renegotiation (for screen share)
    webrtcService.on('needsrenegotiation', async () => {
      const { callId, isInitiator } = get()
      if (!callId) return

      // Only initiator sends offers, callee waits
      if (isInitiator) {
        try {
          const offer = await webrtcService.createOffer()
          wsService.send('call_offer', { call_id: callId, sdp: offer })
        } catch (error) {
          console.error('[Call] Renegotiation error:', error)
        }
      }
    })

    // WebRTC: Screen share ended
    webrtcService.on('screenshareended', () => {
      const { callId } = get()
      set({ isScreenSharing: false })
      if (callId) {
        wsService.send('call_screen_share', { call_id: callId, is_sharing: false })
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
