/**
 * Call Sound Service - Ringtone using Web Audio API
 */

class CallSoundService {
  private audioContext: AudioContext | null = null
  private isPlaying = false
  private ringtoneInterval: NodeJS.Timeout | null = null

  /**
   * Initialize audio context (must be called after user interaction)
   */
  private initContext(): void {
    if (!this.audioContext) {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
    }
  }

  /**
   * Play a single tone
   */
  private playTone(frequency: number, duration: number, volume: number = 0.3): void {
    this.initContext()
    if (!this.audioContext) return

    const oscillator = this.audioContext.createOscillator()
    const gainNode = this.audioContext.createGain()

    oscillator.connect(gainNode)
    gainNode.connect(this.audioContext.destination)

    oscillator.frequency.value = frequency
    oscillator.type = 'sine'

    gainNode.gain.setValueAtTime(volume, this.audioContext.currentTime)
    gainNode.gain.exponentialRampToValueAtTime(
      0.01,
      this.audioContext.currentTime + duration
    )

    oscillator.start(this.audioContext.currentTime)
    oscillator.stop(this.audioContext.currentTime + duration)
  }

  /**
   * Play ringtone pattern (incoming call)
   */
  startRingtone(): void {
    if (this.isPlaying) return
    this.isPlaying = true

    // Play two-tone pattern repeatedly
    const playPattern = () => {
      if (!this.isPlaying) return

      // First tone
      this.playTone(440, 0.2, 0.4) // A4

      // Second tone after 200ms
      setTimeout(() => {
        if (this.isPlaying) {
          this.playTone(554.37, 0.2, 0.4) // C#5
        }
      }, 250)
    }

    // Play immediately
    playPattern()

    // Repeat every 2 seconds
    this.ringtoneInterval = setInterval(playPattern, 2000)
  }

  /**
   * Stop ringtone
   */
  stopRingtone(): void {
    this.isPlaying = false
    if (this.ringtoneInterval) {
      clearInterval(this.ringtoneInterval)
      this.ringtoneInterval = null
    }
  }

  /**
   * Play call accepted sound
   */
  playAccepted(): void {
    // Rising tone
    this.playTone(440, 0.15, 0.3)
    setTimeout(() => this.playTone(554.37, 0.15, 0.3), 100)
    setTimeout(() => this.playTone(659.25, 0.2, 0.3), 200)
  }

  /**
   * Play call rejected/ended sound
   */
  playEnded(): void {
    // Falling tone
    this.playTone(440, 0.15, 0.3)
    setTimeout(() => this.playTone(349.23, 0.15, 0.3), 100)
    setTimeout(() => this.playTone(293.66, 0.3, 0.3), 200)
  }

  /**
   * Play dial tone (outgoing call)
   */
  startDialTone(): void {
    if (this.isPlaying) return
    this.isPlaying = true

    const playBeep = () => {
      if (!this.isPlaying) return
      this.playTone(440, 0.5, 0.2)
    }

    playBeep()
    this.ringtoneInterval = setInterval(playBeep, 3000)
  }

  /**
   * Stop dial tone
   */
  stopDialTone(): void {
    this.stopRingtone()
  }

  /**
   * Cleanup
   */
  dispose(): void {
    this.stopRingtone()
    if (this.audioContext) {
      this.audioContext.close()
      this.audioContext = null
    }
  }
}

export const callSoundService = new CallSoundService()
export default callSoundService
