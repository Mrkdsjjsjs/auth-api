type MessageHandler = (data: any) => void

class WebSocketService {
  private ws: WebSocket | null = null
  private handlers: Map<string, MessageHandler[]> = new Map()
  private reconnectAttempts = 0
  private maxReconnectAttempts = 5
  private reconnectDelay = 1000
  private registeredEvents: Set<string> = new Set()

  connect(token: string) {
    // Don't reconnect if already connected
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      console.log('[WS] Already connected, skipping reconnect')
      return
    }

    // Use wss:// for HTTPS, ws:// for HTTP
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = import.meta.env.VITE_WS_URL || `${protocol}//${window.location.host}`
    const url = `${wsUrl}/ws/${token}`
    console.log('[WS] Connecting to:', url)
    this.ws = new WebSocket(url)

    this.ws.onopen = () => {
      console.log('[WS] Connected successfully')
      console.log('[WS] Registered handlers:', Array.from(this.handlers.keys()))
      this.reconnectAttempts = 0
    }

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        console.log('[WS Raw] Received message type:', data.type, data)
        const handlers = this.handlers.get(data.type) || []
        console.log('[WS Raw] Found', handlers.length, 'handlers for type:', data.type)
        handlers.forEach((handler) => handler(data))

        // Also call 'all' handlers
        const allHandlers = this.handlers.get('all') || []
        allHandlers.forEach((handler) => handler(data))
      } catch (e) {
        console.error('Failed to parse WebSocket message:', e)
      }
    }

    this.ws.onclose = () => {
      console.log('WebSocket disconnected')
      this.attemptReconnect(token)
    }

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error)
    }
  }

  private attemptReconnect(token: string) {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++
      console.log(`Reconnecting... attempt ${this.reconnectAttempts}`)
      setTimeout(() => this.connect(token), this.reconnectDelay * this.reconnectAttempts)
    }
  }

  disconnect() {
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
  }

  on(event: string, handler: MessageHandler, unique = false) {
    // If unique is true and we've already registered this event, skip
    if (unique && this.registeredEvents.has(event)) {
      console.log('[WS] Skipping duplicate registration for:', event)
      return
    }

    if (!this.handlers.has(event)) {
      this.handlers.set(event, [])
    }
    this.handlers.get(event)!.push(handler)

    if (unique) {
      this.registeredEvents.add(event)
    }
    console.log('[WS] Registered handler for:', event, 'total:', this.handlers.get(event)!.length)
  }

  off(event: string, handler: MessageHandler) {
    const handlers = this.handlers.get(event)
    if (handlers) {
      const index = handlers.indexOf(handler)
      if (index > -1) {
        handlers.splice(index, 1)
      }
    }
  }

  send(type: string, data: any) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, ...data }))
    }
  }

  sendTyping(chatId: string, isTyping: boolean) {
    this.send(isTyping ? 'typing_start' : 'typing_stop', { chat_id: chatId })
  }

  sendReadReceipt(chatId: string, messageId: string) {
    this.send('read_receipt', { chat_id: chatId, message_id: messageId })
  }
}

export const wsService = new WebSocketService()
export default wsService
