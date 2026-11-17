import { useEffect, useRef } from 'react'
import Hls from 'hls.js'

type HlsPlayerProps = {
  src: string
  poster?: string | null
  autoPlay?: boolean
}

export function HlsPlayer({ src, poster, autoPlay = true }: HlsPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const video = videoRef.current
    if (!video || !src) return

    const isHlsSource = /\.m3u8(\?|$)/i.test(src) || /\/hls\//i.test(src)

    if (!isHlsSource) {
      video.src = src
      return () => {
        video.removeAttribute('src')
        video.load()
      }
    }

    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src
      return () => {
        video.removeAttribute('src')
        video.load()
      }
    }

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        backBufferLength: 30
      })
      hls.loadSource(src)
      hls.attachMedia(video)
      return () => {
        hls.destroy()
      }
    }

    video.src = src
    return () => {
      video.removeAttribute('src')
      video.load()
    }
  }, [src])

  return (
    <video
      className="stream-player"
      ref={videoRef}
      poster={poster || undefined}
      controls
      playsInline
      autoPlay={autoPlay}
    />
  )
}
