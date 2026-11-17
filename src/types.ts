export type Category = 'Moments' | 'Travel' | 'Field notes'
export type Tone = 'sage' | 'sand' | 'lilac' | 'blue'
export type SortMode = 'newest' | 'oldest' | 'title' | 'largest' | 'longest'
export type StatusFilter = 'all' | 'Ready' | 'Processing' | 'Failed'
export type NavSection = 'All videos' | Category | 'Constellation' | 'Trash'

export const CATEGORIES: Category[] = ['Moments', 'Travel', 'Field notes']
export const LIBRARY_TABS: ('All videos' | Category)[] = ['All videos', 'Moments', 'Travel', 'Field notes']

export type Clip = {
  id: string
  title: string
  originalName: string
  uploadedAt: string
  date: string
  duration: string
  durationSeconds: number
  width?: number
  height?: number
  sizeBytes: number
  size: string
  tone: Tone
  accentColor?: string
  status: 'Queued' | 'Processing' | 'Ready' | 'Failed' | string
  category: Category | string
  streamUrl: string
  thumbnailUrl: string | null
  thumbnailReady: boolean
  shareToken?: string
  deletedAt?: string
  error?: string
  processing?: { stage: string; progress: number }
}

export type User = {
  id: string
  name: string
  email: string
  createdAt?: string
}

export type HealthInfo = {
  ok: boolean
  service: string
  storage: 'supabase' | 'local'
  hls: boolean
  ffmpeg: boolean
  activeJobs: number
}

export const TONE_COLORS: Record<string, string> = {
  sage: '#c5d6a2',
  sand: '#dfc89f',
  lilac: '#c4a9c8',
  blue: '#9ab5b4'
}

export function toneColor(tone: string, accentColor?: string): string {
  return accentColor || TONE_COLORS[tone] || TONE_COLORS.sage
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB'
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(bytes >= 100e6 ? 0 : 1)} MB`
  if (bytes >= 1e3) return `${Math.round(bytes / 1e3)} KB`
  return `${bytes} B`
}

export function formatDate(iso?: string): string {
  if (!iso) return 'Just now'
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    }).format(new Date(iso))
  } catch {
    return 'Just now'
  }
}

export function parseDurationToSeconds(duration?: string, rawSeconds?: number | null): number {
  if (typeof rawSeconds === 'number' && Number.isFinite(rawSeconds)) return rawSeconds
  if (!duration) return 0
  const parts = duration.split(':').map(Number)
  if (parts.some(n => !Number.isFinite(n))) return 0
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  return 0
}

export function formatTotalDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds))
  if (s < 60) return `${s}s`
  const mins = Math.floor(s / 60)
  const remS = s % 60
  if (mins < 60) return `${mins}m ${remS}s`
  const hrs = Math.floor(mins / 60)
  const remM = mins % 60
  return `${hrs}h ${remM}m`
}

export function mapApiClip(item: any): Clip {
  const sizeBytes = Number(item.size) || 0
  const durationSeconds = parseDurationToSeconds(item.duration, item.durationSeconds)
  return {
    id: String(item.id),
    title: item.title || 'Untitled Clip',
    originalName: item.originalName || '',
    uploadedAt: item.uploadedAt || new Date().toISOString(),
    date: formatDate(item.uploadedAt),
    duration: item.duration || 'Preparing',
    durationSeconds,
    width: item.width ? Number(item.width) : undefined,
    height: item.height ? Number(item.height) : undefined,
    sizeBytes,
    size: formatBytes(sizeBytes),
    tone: (['sage', 'sand', 'lilac', 'blue'].includes(item.tone) ? item.tone : 'sage') as Tone,
    accentColor: item.accentColor || undefined,
    status: item.status || 'Queued',
    category: item.category || 'Moments',
    streamUrl: `/api/videos/${item.id}/playback`,
    thumbnailUrl: item.thumbnailUrl || null,
    thumbnailReady: Boolean(item.thumbnailReady && item.thumbnailUrl),
    shareToken: item.shareToken,
    deletedAt: item.deletedAt,
    error: item.error,
    processing: item.processing
  }
}
