// Notification service for new messages

class NotificationService {
  private audioContext: AudioContext | null = null
  private notificationPermission: NotificationPermission = 'default'

  constructor() {
    // Check notification permission on init
    if ('Notification' in window) {
      this.notificationPermission = Notification.permission
    }
  }

  // Request permission for browser notifications
  async requestPermission(): Promise<boolean> {
    if (!('Notification' in window)) {
      console.log('Browser does not support notifications')
      return false
    }

    if (this.notificationPermission === 'granted') {
      return true
    }

    if (this.notificationPermission !== 'denied') {
      const permission = await Notification.requestPermission()
      this.notificationPermission = permission
      return permission === 'granted'
    }

    return false
  }

  // Play notification sound using Web Audio API
  playSound() {
    try {
      // Create audio context lazily (browsers require user interaction first)
      if (!this.audioContext) {
        this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
      }

      const ctx = this.audioContext

      // Resume if suspended (required after page interaction)
      if (ctx.state === 'suspended') {
        ctx.resume()
      }

      // Create a pleasant notification sound
      const oscillator = ctx.createOscillator()
      const gainNode = ctx.createGain()

      oscillator.connect(gainNode)
      gainNode.connect(ctx.destination)

      // Sound parameters - pleasant "ding" tone
      oscillator.frequency.setValueAtTime(800, ctx.currentTime)
      oscillator.frequency.setValueAtTime(600, ctx.currentTime + 0.1)
      oscillator.type = 'sine'

      // Envelope - quick attack, smooth decay
      gainNode.gain.setValueAtTime(0, ctx.currentTime)
      gainNode.gain.linearRampToValueAtTime(0.3, ctx.currentTime + 0.01)
      gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3)

      oscillator.start(ctx.currentTime)
      oscillator.stop(ctx.currentTime + 0.3)
    } catch (error) {
      console.warn('Failed to play notification sound:', error)
    }
  }

  // Show browser notification
  showNotification(title: string, body: string, onClick?: () => void) {
    if (!('Notification' in window)) return

    if (this.notificationPermission !== 'granted') {
      // Try to request permission
      this.requestPermission()
      return
    }

    try {
      const notification = new Notification(title, {
        body,
        icon: '/favicon.ico',
        tag: 'new-message', // Prevents stacking multiple notifications
        renotify: true,
      })

      if (onClick) {
        notification.onclick = () => {
          window.focus()
          onClick()
          notification.close()
        }
      }

      // Auto-close after 5 seconds
      setTimeout(() => notification.close(), 5000)
    } catch (error) {
      console.warn('Failed to show notification:', error)
    }
  }

  // Combined: play sound and show notification
  notify(senderName: string, messagePreview: string, onClick?: () => void) {
    // Always play sound
    this.playSound()

    // Show browser notification if tab is not focused
    if (document.hidden || !document.hasFocus()) {
      this.showNotification(
        senderName,
        messagePreview.length > 50 ? messagePreview.substring(0, 47) + '...' : messagePreview,
        onClick
      )
    }
  }
}

export const notificationService = new NotificationService()
