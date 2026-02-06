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

  // Actions
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

      // Get ICE servers from backend
      const { data } = await callsApi.getIceServers()
      await webrtcService.init(data.ice_servers)

      // Create peer connection
      await webrtcService.createConnection(true)

      // Send call initiation
      wsService.send('call_initiate', {
        chat_id: chatId,
        callee_id: calleeId,
      })

      // Start dial tone
      callSoundService.startDialTone()
      set({ status: 'ringing' })
    } catch (error: any) {
      console.error('[Call] Failed to initiate call:', error)
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

      // Get ICE servers from backend
      const { data } = await callsApi.getIceServers()
      await webrtcService.init(data.ice_servers)

      // Create peer connection
      await webrtcService.createConnection(false)

      // Send accept
      wsService.send('call_accept', { call_id: callId })

      callSoundService.playAccepted()
    } catch (error: any) {
      console.error('[Call] Failed to accept call:', error)
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
    // Call initiated confirmation
    wsService.on('call_initiated', (data) => {
      console.log('[Call] Call initiated:', data)

      // Only the tab that initiated the call should process this
      const { status, isInitiator } = get()
      if (!isInitiator || (status !== 'initiating' && status !== 'ringing')) {
        console.log('[Call] Not the initiating tab, ignoring call_initiated')
        return
      }

      set({ callId: data.call_id })
    }, true)

    // Incoming call
    wsService.on('call_incoming', (data) => {
      console.log('[Call] Incoming call:', data)

      // Don't show incoming call if we're already in a call
      const { status } = get()
      if (status !== 'idle') {
        console.log('[Call] Already in a call, ignoring incoming')
        return
      }

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
      console.log('[Call] Call accepted:', data)

      // Only the initiator tab should handle call_accepted
      const { status, isInitiator } = get()
      if (!isInitiator) {
        console.log('[Call] Not the initiator, ignoring call_accepted')
        return
      }

      // Prevent duplicate processing
      if (status === 'connecting' || status === 'active') {
        console.log('[Call] Already connecting/active, ignoring duplicate accepted')
        return
      }

      set({ status: 'connecting' })
      callSoundService.stopDialTone()
      callSoundService.playAccepted()

      // Create and send offer
      try {
        const offer = await webrtcService.createOffer()
        wsService.send('call_offer', {
          call_id: data.call_id,
          sdp: offer,
        })
      } catch (error) {
        console.error('[Call] Failed to create offer:', error)
        get().endCall()
      }
    }, true)

    // Call rejected
    wsService.on('call_rejected', (data) => {
      console.log('[Call] Call rejected:', data)
      callSoundService.stopDialTone()
      callSoundService.playEnded()
      webrtcService.close()
      set({ error: data.reason || 'Call rejected' })
      setTimeout(() => get().reset(), 2000)
    }, true)

    // Call accepted on another device (same user, multiple devices)
    wsService.on('call_accepted_on_other_device', (data) => {
      console.log('[Call] Call accepted on another device:', data)
      const currentStatus = get().status

      // Only handle if we're in incoming state (ringing)
      if (currentStatus === 'incoming') {
        callSoundService.stopRingtone()
        set({ status: 'idle', error: 'Answered on another device' })
        setTimeout(() => get().reset(), 2000)
      }
    }, true)

    // Call ended
    wsService.on('call_ended', (data) => {
      console.log('[Call] Call ended:', data)
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

    // WebRTC offer
    let processingOffer = false
    wsService.on('call_offer', async (data) => {
      console.log('[Call] Received offer')

      // Only process if this tab is handling the call
      const { callId, status } = get()
      if (!callId || callId !== data.call_id) {
        console.log('[Call] Not our call, ignoring offer')
        return
      }

      // Only the callee (non-initiator) should process offers initially
      // But both sides can process offers during renegotiation
      if (status === 'idle') {
        console.log('[Call] Not in a call, ignoring offer')
        return
      }

      // Prevent concurrent processing (but allow sequential for renegotiation)
      if (processingOffer) {
        console.log('[Call] Already processing offer, queuing')
        return
      }
      processingOffer = true

      // Wait for peer connection to be ready (max 5 seconds)
      let attempts = 0
      while (!webrtcService.isReady() && attempts < 50) {
        await new Promise(resolve => setTimeout(resolve, 100))
        attempts++
      }

      if (!webrtcService.isReady()) {
        console.error('[Call] Peer connection not ready')
        processingOffer = false
        get().endCall()
        return
      }

      try {
        await webrtcService.setRemoteDescription(data.sdp)
        const answer = await webrtcService.createAnswer()
        wsService.send('call_answer', {
          call_id: data.call_id,
          sdp: answer,
        })
        console.log('[Call] Answer sent')
        processingOffer = false  // Allow next offer (renegotiation)
      } catch (error) {
        console.error('[Call] Failed to handle offer:', error)
        processingOffer = false
        get().endCall()
      }
    }, true)

    // WebRTC answer
    let processingAnswer = false
    wsService.on('call_answer', async (data) => {
      console.log('[Call] Received answer')

      // Only process if this tab is handling the call
      const { callId, isInitiator } = get()
      if (!callId || callId !== data.call_id) {
        console.log('[Call] Not our call, ignoring answer')
        return
      }

      // Only the initiator should process answers
      if (!isInitiator) {
        console.log('[Call] Not the initiator, ignoring answer')
        return
      }

      // Prevent concurrent processing
      if (processingAnswer) {
        console.log('[Call] Already processing answer, ignoring')
        return
      }
      processingAnswer = true

      try {
        await webrtcService.setRemoteDescription(data.sdp)
        console.log('[Call] Remote description set')
        processingAnswer = false  // Allow next answer (renegotiation)
      } catch (error) {
        console.error('[Call] Failed to handle answer:', error)
        processingAnswer = false
        get().endCall()
      }
    }, true)

    // ICE candidate
    wsService.on('call_ice_candidate', async (data) => {
      // Only process if this tab is handling the call
      const { callId } = get()
      if (!callId || callId !== data.call_id) {
        return
      }

      if (data.candidate) {
        await webrtcService.addIceCandidate(data.candidate)
      }
    }, true)

    // Remote mute status
    wsService.on('call_mute', (data) => {
      set({ isRemoteMuted: data.is_muted })
    }, true)

    // Remote screen share status
    wsService.on('call_screen_share', (data) => {
      set({ isRemoteScreenSharing: data.is_sharing })
    }, true)

    // Call error
    wsService.on('call_error', (data) => {
      console.error('[Call] Error:', data.error)
      callSoundService.stopDialTone()
      callSoundService.stopRingtone()
      webrtcService.close()

      // User-friendly error messages
      let errorMessage = data.error
      if (data.error === 'User is offline') {
        errorMessage = 'User is offline'
      }

      set({ status: 'ended', error: errorMessage })
      setTimeout(() => get().reset(), 3000)
    }, true)

    // WebRTC ICE candidate handler
    webrtcService.on('icecandidate', (candidate) => {
      const { callId } = get()
      if (callId) {
        wsService.send('call_ice_candidate', {
          call_id: callId,
          candidate,
        })
      }
    })

    // WebRTC connection state handler
    webrtcService.on('connectionstatechange', (state) => {
      console.log('[Call] Connection state:', state)
      if (state === 'connected') {
        set({ status: 'active' })

        // Start call duration timer (only once)
        if (!durationInterval) {
          durationInterval = setInterval(() => {
            set((s) => ({ callDuration: s.callDuration + 1 }))
          }, 1000)
        }
      } else if (state === 'disconnected' || state === 'failed') {
        // Don't end call - ICE restart will attempt recovery
        // Connection will recover or user can end manually
        console.log('[Call] Connection issue, attempting recovery...')
      }
    })

    // Handle renegotiation (for screen share)
    webrtcService.on('needsrenegotiation', async () => {
      const { callId } = get()
      if (!callId) return

      console.log('[Call] Renegotiation needed, creating new offer')
      try {
        const offer = await webrtcService.createOffer()
        wsService.send('call_offer', {
          call_id: callId,
          sdp: offer,
        })
      } catch (error) {
        console.error('[Call] Renegotiation failed:', error)
      }
    })

    // Screen share ended by browser
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
