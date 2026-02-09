import { memo, useEffect, useRef, useState } from 'react'

interface VideoAvatarProps {
  src: string
  className?: string
}

// Global cache for video blob URLs to prevent re-fetching
const videoCache = new Map<string, string>()

const VideoAvatarComponent = ({ src, className = 'avatar-img' }: VideoAvatarProps) => {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [blobUrl, setBlobUrl] = useState<string | null>(null)

  useEffect(() => {
    // Check cache first
    if (videoCache.has(src)) {
      setBlobUrl(videoCache.get(src)!)
      return
    }

    // Fetch and cache the video
    let mounted = true
    fetch(src)
      .then(res => res.blob())
      .then(blob => {
        if (mounted) {
          const url = URL.createObjectURL(blob)
          videoCache.set(src, url)
          setBlobUrl(url)
        }
      })
      .catch(err => {
        console.warn('[VideoAvatar] Failed to cache:', err)
        // Fallback to direct URL
        if (mounted) setBlobUrl(src)
      })

    return () => {
      mounted = false
    }
  }, [src])

  // Don't revoke URL - keep in cache for reuse
  // URLs will be cleaned up when page unloads

  if (!blobUrl) {
    // Show placeholder while loading
    return <div className={className} style={{ background: '#2a2a2a' }} />
  }

  return (
    <video
      ref={videoRef}
      src={blobUrl}
      autoPlay
      loop
      muted
      playsInline
      className={className}
    />
  )
}

// Memoize to prevent unnecessary re-renders
export const VideoAvatar = memo(VideoAvatarComponent, (prev, next) => prev.src === next.src)
