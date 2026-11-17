import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  ArrowDownUp,
  ArrowUpRight,
  Check,
  ChevronDown,
  CircleHelp,
  Cloud,
  CloudOff,
  CloudUpload,
  Download,
  Edit3,
  Film,
  Filter,
  Folder,
  Grid2X2,
  HardDrive,
  Link2,
  List,
  MoreHorizontal,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Settings2,
  Sparkles,
  Trash2,
  WifiOff,
  X
} from 'lucide-react'
import { HlsPlayer } from './components/HlsPlayer'
import { ConstellationBanner, ConstellationExplorer } from './components/ConstellationView'
import {
  clearAllOfflineData,
  deleteOfflineVideo,
  getOfflineThumb,
  getOfflineVideo,
  listOfflineVideoIds,
  saveOfflineThumb,
  saveOfflineVideo
} from './offlineStore'
import {
  CATEGORIES,
  Category,
  Clip,
  formatBytes,
  formatDate,
  formatTotalDuration,
  HealthInfo,
  LIBRARY_TABS,
  mapApiClip,
  NavSection,
  SortMode,
  StatusFilter,
  toneColor,
  User
} from './types'

const STORAGE_QUOTA_BYTES = 100 * 1e9
const AUTO_OFFLINE_MAX_BYTES = 150 * 1024 * 1024
const LS_USER_KEY = 'afterframe:user'
const LS_CLIPS_KEY = 'afterframe:clips'
const LS_TRASH_KEY = 'afterframe:trash'

function readStorageJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function writeStorageJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Ignore quota errors
  }
}

const SORT_LABELS: Record<SortMode, string> = {
  newest: 'Newest first',
  oldest: 'Oldest first',
  title: 'Title A–Z',
  largest: 'Largest first',
  longest: 'Longest first'
}

const SORT_ORDER: SortMode[] = ['newest', 'oldest', 'title', 'largest', 'longest']
const STATUS_ORDER: StatusFilter[] = ['all', 'Ready', 'Processing', 'Failed']

function AuthScreen({ onAuthenticated }: { onAuthenticated: (user: User) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('register')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const payload = mode === 'register' ? { name, email, password } : { email, password }
      const response = await fetch(`/api/auth/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Could not continue')
      onAuthenticated(data.user)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not continue')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-panel">
        <div className="brand">
          <div className="brand-mark">
            <span />
          </div>
          <span>afterframe</span>
          <span className="brand-dot">●</span>
        </div>

        <div className="auth-copy">
          <span className="section-kicker">YOUR PRIVATE VIDEO SPACE</span>
          <h1>{mode === 'register' ? 'Make room for what matters.' : 'Welcome back.'}</h1>
          <p>
            Your library, your account, your stories. Stored and streamed from your own private
            space.
          </p>
        </div>

        <form onSubmit={submit}>
          {mode === 'register' && (
            <label>
              Your name
              <input
                value={name}
                onChange={event => setName(event.target.value)}
                placeholder="Alex Morgan"
                required
                maxLength={80}
                autoComplete="name"
              />
            </label>
          )}
          <label>
            Email address
            <input
              value={email}
              onChange={event => setEmail(event.target.value)}
              placeholder="you@example.com"
              type="email"
              required
              autoComplete="email"
            />
          </label>
          <label>
            Password
            <input
              value={password}
              onChange={event => setPassword(event.target.value)}
              placeholder="At least 8 characters"
              type="password"
              minLength={8}
              required
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
            />
          </label>
          {error && <p className="auth-error">{error}</p>}
          <button className="upload-btn auth-submit" disabled={busy}>
            {busy ? 'Please wait…' : mode === 'register' ? 'Create private library' : 'Sign in'}
          </button>
        </form>

        <button
          type="button"
          className="auth-switch"
          onClick={() => {
            setMode(mode === 'register' ? 'login' : 'register')
            setError('')
          }}
        >
          {mode === 'register'
            ? 'Already have an account? Sign in'
            : 'New here? Create an account'}
        </button>
      </div>

      <div className="auth-art">
        <div className="art-orbit orbit-one" />
        <div className="art-orbit orbit-two" />
        <div className="art-sun" />
        <div className="art-leaf leaf-one" />
        <div className="art-leaf leaf-two" />
        <p>
          Every clip,
          <br />
          <i>somewhere safe.</i>
        </p>
      </div>
    </div>
  )
}

function SharedVideoPage({ token }: { token: string }) {
  const [clip, setClip] = useState<any>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    async function load() {
      try {
        const response = await fetch(`/api/share/${token}`)
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || 'Shared video is unavailable.')
        if (active) {
          setClip(data)
          setError('')
        }
      } catch (reason) {
        if (active) {
          setError(reason instanceof Error ? reason.message : 'Shared video is unavailable.')
        }
      }
    }
    void load()
    const timer = window.setInterval(() => {
      if (!clip?.playbackUrl && !error) void load()
    }, 4000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [token, clip?.playbackUrl, error])

  const subtitle = error
    ? error
    : clip?.status === 'Ready'
      ? `Shared from a private Afterframe library · ${clip.category || 'Moments'} · ${clip.duration || ''}`
      : 'The owner’s video is still being prepared for streaming.'

  return (
    <div className="auth-shell">
      <div className="auth-panel">
        <a className="brand brand-link" href="/">
          <div className="brand-mark">
            <span />
          </div>
          <span>afterframe</span>
          <span className="brand-dot">●</span>
        </a>
        <div className="auth-copy">
          <span className="section-kicker">A PRIVATE SHARE</span>
          <h1>{error ? 'This share is unavailable.' : clip?.title || 'Opening shared video…'}</h1>
          <p>{subtitle}</p>
          {clip && !error && (
            <div className="share-meta">
              <span>{formatDate(clip.uploadedAt)}</span>
              {clip.size ? <span>· {formatBytes(Number(clip.size))}</span> : null}
            </div>
          )}
          <a className="share-home-link" href="/">
            Open Afterframe <ArrowUpRight size={14} />
          </a>
        </div>
      </div>

      <div className="share-player">
        {clip?.playbackUrl ? (
          <HlsPlayer src={clip.playbackUrl} poster={clip.thumbnailUrl} />
        ) : (
          <div className="preparing">
            <b>{error ? 'Link expired or removed' : clip?.processing?.stage || 'Preparing secure playback…'}</b>
            <span>
              {error
                ? 'Ask the owner for a new viewing link.'
                : `${clip?.processing?.progress ?? 0}% complete`}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

type ToastState = {
  message: string
  actionLabel?: string
  onAction?: () => void
} | null

function App() {
  const [clips, setClips] = useState<Clip[]>([])
  const [trash, setTrash] = useState<Clip[]>([])
  const [section, setSection] = useState<NavSection>('All videos')
  const [query, setQuery] = useState('')
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [sortMode, setSortMode] = useState<SortMode>('newest')
  const [selected, setSelected] = useState<Clip | null>(null)
  const [playback, setPlayback] = useState('')
  const [uploading, setUploading] = useState<{ count: number; progress: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const [toast, setToast] = useState<ToastState>(null)
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState<User | null>(null)
  const [checking, setChecking] = useState(true)
  const [isOffline, setIsOffline] = useState(!navigator.onLine)
  const [offlineIds, setOfflineIds] = useState<Set<string>>(new Set())
  const [cachingId, setCachingId] = useState<string | null>(null)
  const [offlineThumbs, setOfflineThumbs] = useState<Record<string, string>>({})
  const [playbackNotice, setPlaybackNotice] = useState('')

  // Modal states
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [profileName, setProfileName] = useState('')
  const [savingProfile, setSavingProfile] = useState(false)
  const [healthModalOpen, setHealthModalOpen] = useState(false)
  const [health, setHealth] = useState<HealthInfo | null>(null)
  const [storageModalOpen, setStorageModalOpen] = useState(false)
  const [helpModalOpen, setHelpModalOpen] = useState(false)

  // Clip detail edit states
  const [editingClip, setEditingClip] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editCategory, setEditCategory] = useState<Category>('Moments')
  const [savingClip, setSavingClip] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [confirmPermanentId, setConfirmPermanentId] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const toastTimerRef = useRef<number | null>(null)
  const playbackBlobRef = useRef<string | null>(null)
  const offlineThumbsRef = useRef<Record<string, string>>({})
  const inFlightCacheRef = useRef<Set<string>>(new Set())

  const setPlaybackSource = useCallback((nextUrl: string) => {
    if (playbackBlobRef.current && playbackBlobRef.current !== nextUrl) {
      URL.revokeObjectURL(playbackBlobRef.current)
      playbackBlobRef.current = null
    }
    if (nextUrl.startsWith('blob:')) {
      playbackBlobRef.current = nextUrl
    }
    setPlayback(nextUrl)
  }, [])

  const closePlayer = useCallback(() => {
    setSelected(null)
    setEditingClip(false)
    setPlaybackNotice('')
    setPlaybackSource('')
  }, [setPlaybackSource])

  const sharedToken = new URLSearchParams(window.location.search).get('share')

  const notify = useCallback(
    (message: string, action?: { label: string; onClick: () => void }) => {
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current)
      setToast({ message, actionLabel: action?.label, onAction: action?.onClick })
      toastTimerRef.current = window.setTimeout(
        () => setToast(null),
        action ? 5500 : 2800
      )
    },
    []
  )

  const refreshOfflineIndex = useCallback(async () => {
    try {
      const ids = await listOfflineVideoIds()
      setOfflineIds(new Set(ids))
    } catch {
      // IndexedDB unavailable
    }
  }, [])

  const cacheClipThumbnail = useCallback(async (clip: Clip) => {
    if (!clip.thumbnailUrl || offlineThumbsRef.current[clip.id]) return
    try {
      const cached = await getOfflineThumb(clip.id)
      if (cached) {
        const url = URL.createObjectURL(cached)
        offlineThumbsRef.current[clip.id] = url
        setOfflineThumbs(prev => ({ ...prev, [clip.id]: url }))
        return
      }
      if (!navigator.onLine) return
      const res = await fetch(clip.thumbnailUrl)
      if (!res.ok) return
      const blob = await res.blob()
      await saveOfflineThumb(clip.id, blob)
      const url = URL.createObjectURL(blob)
      offlineThumbsRef.current[clip.id] = url
      setOfflineThumbs(prev => ({ ...prev, [clip.id]: url }))
    } catch {
      // Ignore thumbnail cache errors
    }
  }, [])

  const cacheClipForOffline = useCallback(
    async (clip: Clip, { silent = false } = {}) => {
      if (inFlightCacheRef.current.has(clip.id)) return
      inFlightCacheRef.current.add(clip.id)
      if (!silent) setCachingId(clip.id)
      try {
        const response = await fetch(`/api/videos/${clip.id}/original`)
        if (!response.ok) throw new Error('Could not download video for offline playback')
        const blob = await response.blob()
        await saveOfflineVideo(clip.id, blob)
        await cacheClipThumbnail(clip)
        setOfflineIds(prev => new Set(prev).add(clip.id))
        if (!silent) notify(`Saved “${clip.title}” for offline playback`)
      } catch (reason) {
        if (!silent) {
          notify(reason instanceof Error ? reason.message : 'Could not save for offline')
        }
      } finally {
        inFlightCacheRef.current.delete(clip.id)
        if (!silent) setCachingId(current => (current === clip.id ? null : current))
      }
    },
    [cacheClipThumbnail, notify]
  )

  const removeClipFromOffline = useCallback(
    async (clip: Clip) => {
      await deleteOfflineVideo(clip.id)
      setOfflineIds(prev => {
        const next = new Set(prev)
        next.delete(clip.id)
        return next
      })
      notify(`Removed “${clip.title}” from offline storage`)
    },
    [notify]
  )

  const refreshLibrary = useCallback(
    async (silent = false) => {
      if (!navigator.onLine) {
        setIsOffline(true)
        const cachedClips = readStorageJson<Clip[]>(LS_CLIPS_KEY, [])
        const cachedTrash = readStorageJson<Clip[]>(LS_TRASH_KEY, [])
        setClips(cachedClips)
        setTrash(cachedTrash)
        cachedClips.forEach(clip => void cacheClipThumbnail(clip))
        setLoading(false)
        return
      }
      try {
        const [videosRes, trashRes] = await Promise.all([fetch('/api/videos'), fetch('/api/trash')])
        if (videosRes.status === 401) {
          setUser(null)
          localStorage.removeItem(LS_USER_KEY)
          return
        }
        if (!videosRes.ok) throw new Error('Could not load library')
        const [videoItems, trashItems] = await Promise.all([
          videosRes.json(),
          trashRes.ok ? trashRes.json() : Promise.resolve([])
        ])
        const nextClips: Clip[] = videoItems.map(mapApiClip)
        const nextTrash: Clip[] = trashItems.map(mapApiClip)
        setIsOffline(false)
        setClips(nextClips)
        setTrash(nextTrash)
        writeStorageJson(LS_CLIPS_KEY, nextClips)
        writeStorageJson(LS_TRASH_KEY, nextTrash)
        setSelected(current =>
          current ? nextClips.find(clip => clip.id === current.id) || current : null
        )
        nextClips.forEach(clip => {
          void cacheClipThumbnail(clip)
          // Automatically cache recent/small ready videos in the background for offline viewing
          if (
            clip.status === 'Ready' &&
            clip.sizeBytes > 0 &&
            clip.sizeBytes <= AUTO_OFFLINE_MAX_BYTES &&
            !inFlightCacheRef.current.has(clip.id)
          ) {
            void getOfflineVideo(clip.id).then(existing => {
              if (!existing) void cacheClipForOffline(clip, { silent: true })
            })
          }
        })
      } catch {
        setIsOffline(true)
        const cachedClips = readStorageJson<Clip[]>(LS_CLIPS_KEY, [])
        const cachedTrash = readStorageJson<Clip[]>(LS_TRASH_KEY, [])
        if (cachedClips.length) {
          setClips(cachedClips)
          setTrash(cachedTrash)
          cachedClips.forEach(clip => void cacheClipThumbnail(clip))
        } else if (!silent) {
          notify('You are offline — showing saved library')
        }
      } finally {
        setLoading(false)
      }
    },
    [cacheClipForOffline, cacheClipThumbnail, notify]
  )

  const fetchHealth = useCallback(async () => {
    if (!navigator.onLine) {
      setIsOffline(true)
      setHealth(null)
      return
    }
    try {
      const response = await fetch('/api/health')
      if (response.ok) {
        setHealth(await response.json())
        setIsOffline(false)
      }
    } catch {
      setHealth(null)
      setIsOffline(true)
    }
  }, [])

  // Online / offline listeners + load offline IndexedDB index
  useEffect(() => {
    void refreshOfflineIndex()
    const onOnline = () => {
      setIsOffline(false)
      void refreshLibrary(true)
      void fetchHealth()
    }
    const onOffline = () => {
      setIsOffline(true)
    }
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [fetchHealth, refreshLibrary, refreshOfflineIndex])

  // Initial session check (falls back to cached user when offline)
  useEffect(() => {
    ;(async () => {
      if (!navigator.onLine) {
        setIsOffline(true)
        setUser(readStorageJson<User | null>(LS_USER_KEY, null))
        setChecking(false)
        return
      }
      try {
        const response = await fetch('/api/auth/me')
        const data = await response.json()
        const nextUser: User | null = data.user || null
        setUser(nextUser)
        if (nextUser) writeStorageJson(LS_USER_KEY, nextUser)
        else localStorage.removeItem(LS_USER_KEY)
      } catch {
        setIsOffline(true)
        setUser(readStorageJson<User | null>(LS_USER_KEY, null))
      } finally {
        setChecking(false)
      }
    })()
  }, [])

  // Periodic library refresh while signed in (faster when processing jobs exist)
  const hasProcessing = useMemo(
    () => clips.some(clip => clip.status === 'Queued' || clip.status === 'Processing'),
    [clips]
  )

  useEffect(() => {
    if (!user) return
    void refreshLibrary()
    void fetchHealth()
    const interval = window.setInterval(
      () => void refreshLibrary(true),
      hasProcessing ? 2500 : 8000
    )
    return () => window.clearInterval(interval)
  }, [user, hasProcessing, refreshLibrary, fetchHealth])

  // Global keyboard shortcuts: Esc to close modals, / to focus search
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        closePlayer()
        setSettingsOpen(false)
        setHealthModalOpen(false)
        setStorageModalOpen(false)
        setHelpModalOpen(false)
      } else if (
        event.key === '/' &&
        !(event.target instanceof HTMLInputElement) &&
        !(event.target instanceof HTMLTextAreaElement) &&
        !(event.target instanceof HTMLSelectElement)
      ) {
        event.preventDefault()
        searchInputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // Derived stats & visible list
  const visible = useMemo(() => {
    const activeTab = LIBRARY_TABS.includes(section as any) ? section : 'All videos'
    const normalizedQuery = query.trim().toLowerCase()
    const filtered = clips.filter(clip => {
      if (activeTab !== 'All videos' && clip.category !== activeTab) return false
      if (statusFilter === 'Ready' && clip.status !== 'Ready') return false
      if (
        statusFilter === 'Processing' &&
        clip.status !== 'Processing' &&
        clip.status !== 'Queued'
      ) {
        return false
      }
      if (statusFilter === 'Failed' && clip.status !== 'Failed') return false
      if (normalizedQuery) {
        const hay = `${clip.title} ${clip.category} ${clip.tone}`.toLowerCase()
        if (!hay.includes(normalizedQuery)) return false
      }
      return true
    })

    return filtered.slice().sort((a, b) => {
      switch (sortMode) {
        case 'oldest':
          return new Date(a.uploadedAt).getTime() - new Date(b.uploadedAt).getTime()
        case 'title':
          return a.title.localeCompare(b.title)
        case 'largest':
          return b.sizeBytes - a.sizeBytes
        case 'longest':
          return b.durationSeconds - a.durationSeconds
        case 'newest':
        default:
          return new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime()
      }
    })
  }, [clips, section, statusFilter, query, sortMode])

  const allStoredClips = useMemo(() => [...clips, ...trash], [clips, trash])
  const usedBytes = useMemo(
    () => allStoredClips.reduce((total, clip) => total + clip.sizeBytes, 0),
    [allStoredClips]
  )
  const usedText = formatBytes(usedBytes)
  const usedPercent = Math.min(100, (usedBytes / STORAGE_QUOTA_BYTES) * 100)

  const weeklyStats = useMemo(() => {
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
    const recent = clips.filter(clip => new Date(clip.uploadedAt).getTime() >= weekAgo)
    const days = new Set(recent.map(clip => new Date(clip.uploadedAt).toDateString())).size
    return { count: recent.length, days }
  }, [clips])

  const storageBreakdown = useMemo(() => {
    const byCategory = CATEGORIES.map(category => {
      const items = clips.filter(clip => clip.category === category)
      return {
        label: category,
        count: items.length,
        bytes: items.reduce((sum, clip) => sum + clip.sizeBytes, 0)
      }
    })
    const trashBytes = trash.reduce((sum, clip) => sum + clip.sizeBytes, 0)
    const totalDuration = clips.reduce((sum, clip) => sum + clip.durationSeconds, 0)
    return { byCategory, trashBytes, totalDuration }
  }, [clips, trash])

  const categoryCounts = useMemo(() => {
    const map: Record<string, number> = { 'All videos': clips.length }
    for (const cat of CATEGORIES) {
      map[cat] = clips.filter(clip => clip.category === cat).length
    }
    return map
  }, [clips])

  // Upload using XHR for real progress tracking (and immediately store locally for offline playback)
  function upload(files: FileList | null) {
    if (!files?.length) return
    if (!navigator.onLine) {
      notify('Reconnect to the internet to upload new videos')
      return
    }
    const fileArray = Array.from(files)
    const targetCategory: Category = CATEGORIES.includes(section as Category)
      ? (section as Category)
      : 'Moments'
    const formData = new FormData()
    formData.append('category', targetCategory)
    fileArray.forEach(file => formData.append('videos', file))

    setUploading({ count: fileArray.length, progress: 0 })

    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/videos')

    xhr.upload.onprogress = event => {
      if (event.lengthComputable) {
        const percent = Math.round((event.loaded / event.total) * 100)
        setUploading({ count: fileArray.length, progress: percent })
      }
    }

    xhr.onload = () => {
      setUploading(null)
      try {
        const payload = JSON.parse(xhr.responseText || '{}')
        if (xhr.status < 200 || xhr.status >= 300) {
          throw new Error(payload.error || 'Upload failed')
        }
        const saved: Clip[] = payload.map(mapApiClip)
        setClips(previous => {
          const merged = [...saved, ...previous]
          writeStorageJson(LS_CLIPS_KEY, merged)
          return merged
        })
        // Immediately persist uploaded files in IndexedDB so they play offline right away
        saved.forEach((clip, idx) => {
          const sourceFile = fileArray[idx]
          if (sourceFile && sourceFile.size <= AUTO_OFFLINE_MAX_BYTES) {
            void saveOfflineVideo(clip.id, sourceFile).then(() => {
              setOfflineIds(prev => new Set(prev).add(clip.id))
            })
          }
        })
        if (section === 'Trash') setSection('All videos')
        notify(
          `${saved.length} video${saved.length > 1 ? 's' : ''} saved & cached for offline`
        )
      } catch (reason) {
        notify(reason instanceof Error ? reason.message : 'Upload failed')
      }
    }

    xhr.onerror = () => {
      setUploading(null)
      notify('Network error during upload')
    }

    xhr.send(formData)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const playFromOfflineCache = useCallback(
    async (clip: Clip): Promise<boolean> => {
      try {
        const blob = await getOfflineVideo(clip.id)
        if (!blob) return false
        const blobUrl = URL.createObjectURL(blob)
        setPlaybackSource(blobUrl)
        setPlaybackNotice('')
        return true
      } catch {
        return false
      }
    },
    [setPlaybackSource]
  )

  const requestPlayback = useCallback(
    async (clip: Clip, silent = false) => {
      if (!navigator.onLine) {
        const played = await playFromOfflineCache(clip)
        if (!played) {
          setPlaybackNotice(
            'This video is not cached on this device yet. Reconnect once to save it for offline viewing.'
          )
        }
        return
      }
      try {
        const response = await fetch(`/api/videos/${clip.id}/playback`)
        if (response.status === 409) return
        if (!response.ok) throw new Error('Playback is unavailable')
        const data = await response.json()
        setPlaybackSource(data.url)
        setPlaybackNotice('')
        // Background-cache the video on this device so it also works offline later
        if (clip.sizeBytes > 0 && clip.sizeBytes <= AUTO_OFFLINE_MAX_BYTES) {
          void getOfflineVideo(clip.id).then(existing => {
            if (!existing) void cacheClipForOffline(clip, { silent: true })
          })
        }
      } catch (reason) {
        const played = await playFromOfflineCache(clip)
        if (played) {
          setIsOffline(true)
          return
        }
        if (!silent) {
          setPlaybackNotice(
            reason instanceof Error ? reason.message : 'Playback unavailable offline'
          )
        }
      }
    },
    [cacheClipForOffline, playFromOfflineCache, setPlaybackSource]
  )

  function openClip(clip: Clip) {
    setSelected(clip)
    setPlaybackSource('')
    setPlaybackNotice('')
    setEditingClip(false)
    setEditTitle(clip.title)
    setEditCategory(
      CATEGORIES.includes(clip.category as Category) ? (clip.category as Category) : 'Moments'
    )
    setCopiedId(null)
    void requestPlayback(clip)
  }

  // Poll playback automatically while selected clip is still transcoding (when online)
  useEffect(() => {
    if (!selected || playback || selected.status === 'Failed' || isOffline) return
    const timer = window.setInterval(() => void requestPlayback(selected, true), 2500)
    return () => window.clearInterval(timer)
  }, [selected, playback, isOffline, requestPlayback])

  async function saveClipEdits(event: React.FormEvent) {
    event.preventDefault()
    if (!selected) return
    setSavingClip(true)
    try {
      const response = await fetch(`/api/videos/${selected.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: editTitle, category: editCategory })
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Could not update video')
      const updated = mapApiClip(data)
      setClips(previous => previous.map(clip => (clip.id === updated.id ? updated : clip)))
      setSelected(updated)
      setEditingClip(false)
      notify('Video details updated')
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : 'Could not update video')
    } finally {
      setSavingClip(false)
    }
  }

  async function retryProcessing(clip: Clip) {
    try {
      const response = await fetch(`/api/videos/${clip.id}/retry`, { method: 'POST' })
      if (!response.ok) throw new Error('Could not retry transcoding')
      const updated = mapApiClip(await response.json())
      setClips(previous => previous.map(item => (item.id === updated.id ? updated : item)))
      if (selected?.id === updated.id) {
        setSelected(updated)
        setPlayback('')
      }
      notify('Re-queued for HLS transcoding')
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : 'Could not retry')
    }
  }

  function shareClip() {
    if (!selected?.shareToken) return
    const link = `${window.location.origin}/?share=${selected.shareToken}`
    void navigator.clipboard?.writeText(link)
    setCopiedId(selected.id)
    window.setTimeout(() => setCopiedId(null), 2200)
    notify('Private viewing link copied')
  }

  async function restoreVideo(id: string) {
    try {
      const response = await fetch(`/api/videos/${id}/restore`, { method: 'POST' })
      if (!response.ok) throw new Error('Could not restore video')
      const restored = mapApiClip(await response.json())
      setTrash(previous => previous.filter(clip => clip.id !== id))
      setClips(previous => [restored, ...previous])
      notify(`Restored “${restored.title}”`)
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : 'Could not restore video')
    }
  }

  async function moveToTrash(clip: Clip) {
    const response = await fetch(`/api/videos/${clip.id}`, { method: 'DELETE' })
    if (!response.ok) {
      notify('Could not move video to trash')
      return
    }
    setClips(previous => previous.filter(item => item.id !== clip.id))
    setTrash(previous => [{ ...clip, deletedAt: new Date().toISOString() }, ...previous])
    setSelected(null)
    notify(`Moved “${clip.title}” to trash`, {
      label: 'Undo',
      onClick: () => void restoreVideo(clip.id)
    })
  }

  async function permanentlyDelete(clip: Clip) {
    const response = await fetch(`/api/videos/${clip.id}/permanent`, { method: 'DELETE' })
    if (!response.ok) {
      notify('Could not permanently delete video')
      return
    }
    void deleteOfflineVideo(clip.id)
    setOfflineIds(prev => {
      const next = new Set(prev)
      next.delete(clip.id)
      return next
    })
    setTrash(previous => previous.filter(item => item.id !== clip.id))
    setConfirmPermanentId(null)
    notify(`Permanently deleted “${clip.title}”`)
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {})
    localStorage.removeItem(LS_USER_KEY)
    localStorage.removeItem(LS_CLIPS_KEY)
    localStorage.removeItem(LS_TRASH_KEY)
    void clearAllOfflineData()
    setOfflineIds(new Set())
    setUser(null)
    setClips([])
    setTrash([])
    closePlayer()
  }

  function openSettings() {
    setProfileName(user?.name || '')
    setSettingsOpen(true)
  }

  async function saveProfile(event: React.FormEvent) {
    event.preventDefault()
    setSavingProfile(true)
    try {
      const response = await fetch('/api/auth/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: profileName })
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Could not save profile')
      setUser(data.user)
      setSettingsOpen(false)
      notify('Profile updated')
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : 'Could not save profile')
    } finally {
      setSavingProfile(false)
    }
  }

  function cycleFilter() {
    const next = STATUS_ORDER[(STATUS_ORDER.indexOf(statusFilter) + 1) % STATUS_ORDER.length]
    setStatusFilter(next)
  }

  function cycleSort() {
    const next = SORT_ORDER[(SORT_ORDER.indexOf(sortMode) + 1) % SORT_ORDER.length]
    setSortMode(next)
    notify(`Sorted: ${SORT_LABELS[next]}`)
  }

  if (sharedToken) return <SharedVideoPage token={sharedToken} />
  if (checking) return <div className="app auth-loading">Loading your private library…</div>
  if (!user) {
    return (
      <AuthScreen
        onAuthenticated={authedUser => {
          writeStorageJson(LS_USER_KEY, authedUser)
          setUser(authedUser)
        }}
      />
    )
  }

  const initials = user.name
    .split(/\s+/)
    .filter(Boolean)
    .map(part => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  const isLibraryView = LIBRARY_TABS.includes(section as any)

  return (
    <div
      className="app"
      onDragEnter={event => {
        event.preventDefault()
        if (event.dataTransfer.types.includes('Files')) setDragging(true)
      }}
      onDragOver={event => {
        event.preventDefault()
      }}
      onDragLeave={event => {
        if (event.currentTarget === event.target) setDragging(false)
      }}
      onDrop={event => {
        event.preventDefault()
        setDragging(false)
        upload(event.dataTransfer.files)
      }}
    >
      {/* Hidden shared file input */}
      <input
        ref={fileInputRef}
        hidden
        type="file"
        accept="video/*"
        multiple
        onChange={event => upload(event.target.files)}
      />

      {/* Sidebar */}
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <span />
          </div>
          <span>afterframe</span>
          <span className="brand-dot">●</span>
        </div>

        <button className="workspace" onClick={openSettings}>
          <div className="workspace-icon">{user.name.slice(0, 1).toUpperCase()}</div>
          <div>
            <b>{user.name}</b>
            <small>Personal space</small>
          </div>
          <ChevronDown size={15} />
        </button>

        <div className="side-label">LIBRARY</div>
        <nav>
          {LIBRARY_TABS.map((tabName, index) => (
            <button
              key={tabName}
              className={`nav-item ${section === tabName ? 'active' : ''}`}
              onClick={() => setSection(tabName)}
            >
              {index === 0 ? <Film size={17} /> : <Folder size={17} />}
              <span>{tabName}</span>
              <em>{categoryCounts[tabName] || 0}</em>
            </button>
          ))}
          <button
            className={`nav-item ${section === 'Constellation' ? 'active' : ''}`}
            onClick={() => setSection('Constellation')}
          >
            <Sparkles size={17} />
            <span>Constellation</span>
          </button>
          <button
            className={`nav-item ${section === 'Trash' ? 'active' : ''}`}
            onClick={() => setSection('Trash')}
          >
            <Trash2 size={17} />
            <span>Trash</span>
            {trash.length > 0 && <em>{trash.length}</em>}
          </button>
        </nav>

        <div className="side-label storage-label">STORAGE</div>
        <div className="storage">
          <div className="storage-top">
            <HardDrive size={16} />
            <span>{health?.storage === 'supabase' ? 'Supabase cloud' : 'Local vault'}</span>
            <button
              className="icon-inline"
              onClick={() => setStorageModalOpen(true)}
              aria-label="Storage details"
            >
              <MoreHorizontal size={16} />
            </button>
          </div>
          <div className="storage-meter">
            <i style={{ width: `${Math.max(usedBytes > 0 ? 3 : 0, usedPercent)}%` }} />
          </div>
          <div className="storage-foot">
            <span>{usedText} used</span>
            <span>of 100 GB</span>
          </div>
          <button className="upgrade" onClick={() => setStorageModalOpen(true)}>
            Storage breakdown <ArrowUpRight size={13} />
          </button>
        </div>

        <div className="sidebar-bottom">
          <button className="nav-item" onClick={openSettings}>
            <Settings2 size={17} />
            <span>Settings</span>
          </button>
          <button className="nav-item" onClick={() => setHelpModalOpen(true)}>
            <CircleHelp size={17} />
            <span>Help & shortcuts</span>
          </button>
          <button className="profile" onClick={openSettings}>
            <div className="avatar">{initials}</div>
            <div>
              <b>{user.name}</b>
              <small>{user.email}</small>
            </div>
            <span className="profile-edit">Edit</span>
          </button>
          <button className="signout profile-signout" onClick={logout}>
            Sign out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main>
        <header className="topbar">
          <div className="crumb">
            Library <span>/</span> <b>{section}</b>
          </div>
          <div className="top-actions">
            {isOffline && (
              <span className="offline-pill" title="Playing cached videos from this device">
                <WifiOff size={13} /> Offline mode
              </span>
            )}
            <button
              className="icon-button"
              title="System status"
              onClick={() => {
                void fetchHealth()
                setHealthModalOpen(true)
              }}
            >
              <Activity size={17} />
              <span className={`online ${isOffline || (health && !health.ok) ? 'offline' : ''}`} />
            </button>
            <button
              className="help"
              title="Help & keyboard shortcuts"
              onClick={() => setHelpModalOpen(true)}
            >
              ?
            </button>
            <button className="avatar mini" onClick={openSettings} title={user.name}>
              {initials}
            </button>
          </div>
        </header>

        <div className="content">
          {section === 'Constellation' ? (
            <ConstellationExplorer
              clips={clips}
              onSelectClip={openClip}
              onUploadClick={() => fileInputRef.current?.click()}
            />
          ) : section === 'Trash' ? (
            <section className="trash-page">
              <div className="library-head">
                <div>
                  <div className="section-kicker">
                    RECOVERABLE STORAGE <span>✳</span>
                  </div>
                  <h2>
                    Trash <span className="count">{trash.length}</span>
                  </h2>
                  <p className="section-sub">
                    Removed videos stay here until you restore them or delete them permanently.
                  </p>
                </div>
              </div>

              {trash.length > 0 ? (
                <div className="trash-list">
                  {trash.map(clip => (
                    <article className="trash-row" key={clip.id}>
                      <div
                        className={`trash-thumb ${clip.tone}`}
                        style={
                          clip.thumbnailUrl
                            ? { backgroundImage: `url("${clip.thumbnailUrl}")` }
                            : undefined
                        }
                      >
                        <span className="duration">{clip.duration}</span>
                      </div>
                      <div className="trash-info">
                        <h3>{clip.title}</h3>
                        <p>
                          {clip.category} · {clip.size} · Deleted {formatDate(clip.deletedAt)}
                        </p>
                      </div>
                      <div className="trash-actions">
                        <button className="tool-button" onClick={() => void restoreVideo(clip.id)}>
                          <RotateCcw size={13} /> Restore
                        </button>
                        {confirmPermanentId === clip.id ? (
                          <button
                            className="danger-button solid"
                            onClick={() => void permanentlyDelete(clip)}
                          >
                            Confirm delete
                          </button>
                        ) : (
                          <button
                            className="danger-button"
                            onClick={() => setConfirmPermanentId(clip.id)}
                          >
                            <Trash2 size={13} /> Delete forever
                          </button>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="empty">
                  <div className="empty-icon">
                    <Trash2 size={22} />
                  </div>
                  <h3>Trash is empty</h3>
                  <p>Deleted videos will appear here so you can always restore them.</p>
                </div>
              )}
            </section>
          ) : (
            <>
              {/* Hero Welcome */}
              <section className="welcome">
                <div>
                  <div className="eyebrow">
                    <span className="live-dot" /> YOUR LITTLE CORNER OF THE CLOUD
                  </div>
                  <h1>
                    Keep the moments
                    <br />
                    <i>that move you.</i>
                  </h1>
                  <p>A private home for your videos — transcoded to HLS and mapped by color.</p>
                </div>
                <div className="welcome-art">
                  <div className="art-orbit orbit-one" />
                  <div className="art-orbit orbit-two" />
                  <div className="art-sun" />
                  <div className="art-leaf leaf-one" />
                  <div className="art-leaf leaf-two" />
                  <div className="art-card">
                    <Play size={17} fill="currentColor" />
                    <span>your story, still unfolding</span>
                  </div>
                </div>
              </section>

              {/* Real Quick Stats */}
              <section className="quick-stats">
                <div className="stat">
                  <div className="stat-icon green">
                    <Film size={16} />
                  </div>
                  <div>
                    <strong>{clips.length.toString().padStart(2, '0')}</strong>
                    <span>videos saved</span>
                  </div>
                </div>
                <div className="stat">
                  <div className="stat-icon tan">
                    <Cloud size={16} />
                  </div>
                  <div>
                    <strong>{usedText}</strong>
                    <span>of 100 GB used</span>
                  </div>
                </div>
                <div className="stat">
                  <div className="stat-icon pink">
                    <Sparkles size={16} />
                  </div>
                  <div>
                    <strong>
                      {weeklyStats.count}{' '}
                      <small>{weeklyStats.count === 1 ? 'clip' : 'clips'}</small>
                    </strong>
                    <span>
                      {weeklyStats.days > 0
                        ? `across ${weeklyStats.days} day${weeklyStats.days === 1 ? '' : 's'} this week`
                        : 'added this week'}
                    </span>
                  </div>
                </div>
                <div className="stat-note">
                  <span>✳</span> Every clip has a place here.
                </div>
              </section>

              {/* Library Header */}
              <section className="library-head">
                <div>
                  <div className="section-kicker">
                    YOUR LIBRARY <span>✳</span>
                  </div>
                  <h2>
                    Video shelf <span className="count">{visible.length}</span>
                  </h2>
                  <p className="section-sub">A few good things, all in one place.</p>
                </div>
                <button className="upload-btn" onClick={() => fileInputRef.current?.click()}>
                  <Plus size={17} /> Add videos
                </button>
              </section>

              {/* Toolbar */}
              <div className="toolbar">
                <div className="tabs">
                  {LIBRARY_TABS.map(tabName => (
                    <button
                      key={tabName}
                      onClick={() => setSection(tabName)}
                      className={section === tabName ? 'chosen' : ''}
                    >
                      {tabName}
                      <span>{categoryCounts[tabName] || 0}</span>
                    </button>
                  ))}
                </div>
                <div className="tools">
                  <label className="search">
                    <Search size={15} />
                    <input
                      ref={searchInputRef}
                      placeholder="Find a video... (/)"
                      value={query}
                      onChange={event => setQuery(event.target.value)}
                    />
                    {query && (
                      <button type="button" onClick={() => setQuery('')} aria-label="Clear search">
                        <X size={13} />
                      </button>
                    )}
                  </label>
                  <button
                    className={`tool-button ${statusFilter !== 'all' ? 'on' : ''}`}
                    onClick={cycleFilter}
                    title="Filter by processing status"
                  >
                    <Filter size={14} />
                    <span>{statusFilter === 'all' ? 'Filter' : statusFilter}</span>
                  </button>
                  <button
                    className={`tool-button ${sortMode !== 'newest' ? 'on' : ''}`}
                    onClick={cycleSort}
                    title={`Sort: ${SORT_LABELS[sortMode]}`}
                  >
                    <ArrowDownUp size={14} />
                    <span className="sort-label">{SORT_LABELS[sortMode]}</span>
                  </button>
                  <div className="view-toggle">
                    <button
                      className={view === 'grid' ? 'selected' : ''}
                      onClick={() => setView('grid')}
                      aria-label="Grid view"
                    >
                      <Grid2X2 size={15} />
                    </button>
                    <button
                      className={view === 'list' ? 'selected' : ''}
                      onClick={() => setView('list')}
                      aria-label="List view"
                    >
                      <List size={16} />
                    </button>
                  </div>
                </div>
              </div>

              {(statusFilter !== 'all' || query) && (
                <div className="filter-note">
                  <span>
                    Showing {visible.length} video{visible.length === 1 ? '' : 's'}
                    {statusFilter !== 'all' ? ` · Status: ${statusFilter}` : ''}
                    {query ? ` · Matching “${query}”` : ''}
                  </span>
                  <button
                    onClick={() => {
                      setStatusFilter('all')
                      setQuery('')
                    }}
                  >
                    Clear filters <X size={13} />
                  </button>
                </div>
              )}

              {/* Video Grid / List */}
              {loading ? (
                <div className="empty">
                  <p>Loading your video shelf…</p>
                </div>
              ) : visible.length > 0 ? (
                <div className={`video-grid ${view === 'list' ? 'list-view' : ''}`}>
                  {visible.map((clip, index) => {
                    const isProcessing =
                      clip.status === 'Queued' || clip.status === 'Processing'
                    const isFailed = clip.status === 'Failed'
                    const isCachedOffline = offlineIds.has(clip.id)
                    const cardAccent = toneColor(clip.tone, clip.accentColor)
                    const thumbSrc = offlineThumbs[clip.id] || clip.thumbnailUrl
                    return (
                      <article className="video-card" key={clip.id}>
                        <button
                          className={`thumbnail ${clip.tone}`}
                          onClick={() => openClip(clip)}
                          style={
                            thumbSrc
                              ? {
                                  backgroundImage: `linear-gradient(180deg, transparent 42%, rgba(11,15,12,.68)), url("${thumbSrc}")`
                                }
                              : {
                                  background: `radial-gradient(circle at 28% 24%, ${cardAccent}36, #191d16 74%)`
                                }
                          }
                        >
                          <span className="duration">{clip.duration}</span>
                          {isCachedOffline && (
                            <span className="offline-chip" title="Available offline on this device">
                              <Check size={10} /> Offline
                            </span>
                          )}
                          <span className="play-button">
                            <Play size={17} fill="currentColor" />
                          </span>
                          <span className="thumb-index">
                            {String(index + 1).padStart(2, '0')}
                          </span>
                          {isProcessing && (
                            <span className="card-progress">
                              <i style={{ width: `${clip.processing?.progress || 8}%` }} />
                            </span>
                          )}
                        </button>
                        <div className="card-meta">
                          <div>
                            <h3 title={clip.title}>{clip.title}</h3>
                            <p>{clip.date}</p>
                          </div>
                          <button
                            className="more"
                            onClick={() => openClip(clip)}
                            aria-label={`Inspect ${clip.title}`}
                          >
                            <MoreHorizontal size={18} />
                          </button>
                        </div>
                        <div className="card-bottom">
                          <span className="tag">
                            <i
                              className={`tag-dot ${clip.tone}`}
                              style={{ background: cardAccent }}
                            />
                            {clip.category}
                          </span>
                          <span className="file-size">{clip.size}</span>
                          <span
                            className={`ready ${isFailed ? 'failed' : isProcessing ? 'busy' : ''}`}
                          >
                            <i />
                            {isProcessing
                              ? `${clip.processing?.progress ?? 0}%`
                              : clip.status}
                          </span>
                        </div>
                      </article>
                    )
                  })}
                </div>
              ) : (
                <div className="empty">
                  <div className="empty-icon">
                    <Film size={22} />
                  </div>
                  <h3>No videos found</h3>
                  <p>
                    {clips.length > 0
                      ? 'Try another search term, category, or status filter.'
                      : 'Drop any video file anywhere on this page or click below to upload.'}
                  </p>
                  <button className="upload-btn" onClick={() => fileInputRef.current?.click()}>
                    <Plus size={16} /> Add a video
                  </button>
                </div>
              )}

              {/* Interactive Memory Constellation Banner */}
              {isLibraryView && (
                <ConstellationBanner
                  clips={clips}
                  onSelectClip={openClip}
                  onExplore={() => setSection('Constellation')}
                />
              )}
            </>
          )}

          <footer>
            <span>Made for the moments that stay.</span>
            <span>
              <i /> {health?.storage === 'supabase' ? 'Supabase cloud storage' : 'Local vault'}
              <b>·</b> Signed HLS streaming
            </span>
            <span>© {new Date().getFullYear()} Afterframe</span>
          </footer>
        </div>
      </main>

      {/* Drag & drop overlay */}
      {dragging && (
        <div className="drop-overlay">
          <div className="drop-card">
            <CloudUpload size={34} />
            <h3>Drop videos to upload</h3>
            <p>
              They’ll be added to{' '}
              <b>{CATEGORIES.includes(section as Category) ? section : 'Moments'}</b> and
              transcoded for HLS streaming.
            </p>
          </div>
        </div>
      )}

      {/* Floating upload progress */}
      {uploading && (
        <div className="uploading">
          <div className="upload-spin">
            <CloudUpload size={17} />
          </div>
          <div className="upload-body">
            <b>
              Uploading {uploading.count} video{uploading.count > 1 ? 's' : ''} ({uploading.progress}
              %)
            </b>
            <div className="upload-bar">
              <i style={{ width: `${uploading.progress}%` }} />
            </div>
          </div>
        </div>
      )}

      {/* Account Settings Modal */}
      {settingsOpen && (
        <div className="modal-backdrop" onClick={() => setSettingsOpen(false)}>
          <form
            className="settings-modal"
            onSubmit={saveProfile}
            onClick={event => event.stopPropagation()}
          >
            <button
              type="button"
              className="modal-close"
              onClick={() => setSettingsOpen(false)}
            >
              <X size={17} />
            </button>
            <span className="section-kicker">ACCOUNT SETTINGS</span>
            <h2>Your private library</h2>
            <p>Update the display name shown across your video space.</p>
            <label>
              Display name
              <input
                value={profileName}
                onChange={event => setProfileName(event.target.value)}
                maxLength={80}
                required
              />
            </label>
            <label>
              Email address
              <input value={user.email} disabled />
            </label>
            <button className="upload-btn settings-save" disabled={savingProfile}>
              {savingProfile ? 'Saving…' : 'Save changes'}
            </button>
          </form>
        </div>
      )}

      {/* System Status Modal */}
      {healthModalOpen && (
        <div className="modal-backdrop" onClick={() => setHealthModalOpen(false)}>
          <div className="settings-modal" onClick={event => event.stopPropagation()}>
            <button
              type="button"
              className="modal-close"
              onClick={() => setHealthModalOpen(false)}
            >
              <X size={17} />
            </button>
            <span className="section-kicker">SYSTEM HEALTH</span>
            <h2>Service diagnostics</h2>
            <p>Live status from your Afterframe storage API and media pipeline.</p>
            <div className="diag-list">
              <div className="diag-row">
                <span>Storage API</span>
                <strong className={health?.ok ? 'ok' : 'warn'}>
                  {health?.ok ? 'Operational' : 'Unreachable'}
                </strong>
              </div>
              <div className="diag-row">
                <span>Persistence backend</span>
                <strong>{health?.storage === 'supabase' ? 'Supabase Cloud' : 'Local Disk'}</strong>
              </div>
              <div className="diag-row">
                <span>FFmpeg transcoder</span>
                <strong className={health?.ffmpeg ? 'ok' : 'warn'}>
                  {health?.ffmpeg ? 'Ready (H.264 / HLS)' : 'Not detected'}
                </strong>
              </div>
              <div className="diag-row">
                <span>Active processing jobs</span>
                <strong>{health?.activeJobs ?? 0}</strong>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Storage Breakdown Modal */}
      {storageModalOpen && (
        <div className="modal-backdrop" onClick={() => setStorageModalOpen(false)}>
          <div className="settings-modal" onClick={event => event.stopPropagation()}>
            <button
              type="button"
              className="modal-close"
              onClick={() => setStorageModalOpen(false)}
            >
              <X size={17} />
            </button>
            <span className="section-kicker">STORAGE OVERVIEW</span>
            <h2>{usedText} used</h2>
            <p>
              {clips.length} active video{clips.length === 1 ? '' : 's'} ·{' '}
              {formatTotalDuration(storageBreakdown.totalDuration)} total runtime
            </p>
            <div className="storage-meter large">
              <i style={{ width: `${Math.max(usedBytes > 0 ? 3 : 0, usedPercent)}%` }} />
            </div>
            <div className="diag-list">
              {storageBreakdown.byCategory.map(row => (
                <div className="diag-row" key={row.label}>
                  <span>
                    {row.label} ({row.count})
                  </span>
                  <strong>{formatBytes(row.bytes)}</strong>
                </div>
              ))}
              <div className="diag-row">
                <span>Trash ({trash.length})</span>
                <strong>{formatBytes(storageBreakdown.trashBytes)}</strong>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Help & Shortcuts Modal */}
      {helpModalOpen && (
        <div className="modal-backdrop" onClick={() => setHelpModalOpen(false)}>
          <div className="settings-modal" onClick={event => event.stopPropagation()}>
            <button
              type="button"
              className="modal-close"
              onClick={() => setHelpModalOpen(false)}
            >
              <X size={17} />
            </button>
            <span className="section-kicker">HELP & SHORTCUTS</span>
            <h2>Using Afterframe</h2>
            <p>Everything runs privately on your configured storage backend.</p>
            <div className="diag-list">
              <div className="diag-row">
                <span>Upload videos</span>
                <strong>Drag & drop anywhere or click Add videos</strong>
              </div>
              <div className="diag-row">
                <span>Private sharing</span>
                <strong>Open any clip → Copy private link</strong>
              </div>
              <div className="diag-row">
                <span>Recover deleted clips</span>
                <strong>Open Trash in the sidebar to restore</strong>
              </div>
              <div className="diag-row">
                <span>Quick search</span>
                <kbd>/</kbd>
              </div>
              <div className="diag-row">
                <span>Close player or modal</span>
                <kbd>Esc</kbd>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Video Player & Inspector Modal */}
      {selected && (
        <div className="modal-backdrop" onClick={closePlayer}>
          <div className="modal" onClick={event => event.stopPropagation()}>
            <button className="modal-close" onClick={closePlayer}>
              <X size={17} />
            </button>

            <div className="modal-image">
              {playback ? (
                <HlsPlayer
                  src={playback}
                  poster={offlineThumbs[selected.id] || selected.thumbnailUrl}
                />
              ) : (
                <div className="preparing">
                  <b>
                    {playbackNotice
                      ? 'Offline copy not saved yet'
                      : selected.status === 'Failed'
                        ? 'Stream conversion failed'
                        : selected.processing?.stage || 'Preparing secure stream'}
                  </b>
                  <span>
                    {playbackNotice
                      ? playbackNotice
                      : selected.status === 'Failed'
                        ? selected.error ||
                          'Try retrying conversion or downloading the original file.'
                        : `${selected.processing?.progress || 0}% complete · playback will start automatically`}
                  </span>
                  {selected.status === 'Failed' && !isOffline && (
                    <button
                      className="upload-btn retry-btn"
                      onClick={() => void retryProcessing(selected)}
                    >
                      <RefreshCw size={13} /> Retry processing
                    </button>
                  )}
                </div>
              )}
              <span className="duration">{selected.duration}</span>
            </div>

            {editingClip ? (
              <form className="modal-edit-form" onSubmit={saveClipEdits}>
                <label>
                  Title
                  <input
                    value={editTitle}
                    onChange={event => setEditTitle(event.target.value)}
                    maxLength={120}
                    required
                  />
                </label>
                <label>
                  Category
                  <select
                    value={editCategory}
                    onChange={event => setEditCategory(event.target.value as Category)}
                  >
                    {CATEGORIES.map(category => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="modal-edit-actions">
                  <button
                    type="button"
                    className="tool-button"
                    onClick={() => setEditingClip(false)}
                  >
                    Cancel
                  </button>
                  <button className="upload-btn" disabled={savingClip}>
                    {savingClip ? 'Saving…' : 'Save details'}
                  </button>
                </div>
              </form>
            ) : (
              <div className="modal-info">
                <div>
                  <span className="section-kicker">
                    {selected.category.toUpperCase()} · {selected.size}
                    {selected.width && selected.height ? ` · ${selected.width}×${selected.height}` : ''}
                  </span>
                  <h2>{selected.title}</h2>
                  <p>
                    {selected.date} <span>·</span> Original quality stored securely
                  </p>
                </div>
                <div className="modal-actions">
                  {offlineIds.has(selected.id) ? (
                    <button
                      className="tool-button on"
                      onClick={() => void removeClipFromOffline(selected)}
                      title="Saved on this device for offline playback (click to remove)"
                    >
                      <Check size={14} /> Saved offline
                    </button>
                  ) : (
                    <button
                      className="tool-button"
                      disabled={isOffline || cachingId === selected.id}
                      onClick={() => void cacheClipForOffline(selected)}
                      title="Store a copy on this device to play without internet"
                    >
                      <CloudOff size={14} />{' '}
                      {cachingId === selected.id ? 'Saving…' : 'Save offline'}
                    </button>
                  )}
                  <button
                    className="tool-button"
                    disabled={isOffline}
                    onClick={() => {
                      setEditTitle(selected.title)
                      setEditCategory(
                        CATEGORIES.includes(selected.category as Category)
                          ? (selected.category as Category)
                          : 'Moments'
                      )
                      setEditingClip(true)
                    }}
                  >
                    <Edit3 size={14} /> Edit
                  </button>
                  <a
                    className="tool-button"
                    href={`/api/videos/${selected.id}/original?download=1`}
                    download
                  >
                    <Download size={14} /> Original
                  </a>
                  <button className="share-button" onClick={shareClip}>
                    {copiedId === selected.id ? <Check size={15} /> : <Link2 size={15} />}
                    {copiedId === selected.id ? 'Link copied' : 'Copy private link'}
                  </button>
                </div>
              </div>
            )}

            <div className="modal-foot">
              <span>
                <i
                  className={`ready-dot ${selected.status === 'Failed' ? 'failed' : ''}`}
                />
                {selected.status === 'Ready'
                  ? 'Ready to stream via signed HLS'
                  : selected.status === 'Failed'
                    ? 'Transcoding failed · original playback fallback available'
                    : `${selected.processing?.stage || selected.status} (${selected.processing?.progress ?? 0}%)`}
              </span>
              <button className="delete-button" onClick={() => void moveToTrash(selected)}>
                <Trash2 size={13} /> Move to trash
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification with optional Undo action */}
      {toast && (
        <div className="toast">
          <Check size={15} />
          <span>{toast.message}</span>
          {toast.actionLabel && toast.onAction && (
            <button
              className="toast-action"
              onClick={() => {
                toast.onAction?.()
                setToast(null)
              }}
            >
              {toast.actionLabel}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export default App
