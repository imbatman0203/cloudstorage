import express from 'express'
import multer from 'multer'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { createHmac, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createClient } from '@supabase/supabase-js'

const exec = promisify(execFile)
const scrypt = promisify(scryptCallback)

const app = express()
app.set('trust proxy', 1)
const port = Number(process.env.PORT || 3001)
const host = process.env.HOST || '127.0.0.1'
const secret = process.env.AFTERFRAME_SIGNING_SECRET || 'afterframe-local-development-secret'

const supabaseUrl = process.env.SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || supabaseServiceKey
const supabase = supabaseUrl && supabaseServiceKey
  ? createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    })
  : null

const createAuthClient = () =>
  createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  })

const cloudBucket = 'afterframe-videos'
const VALID_CATEGORIES = new Set(['Moments', 'Travel', 'Field notes'])
const VALID_TONES = new Set(['sage', 'sand', 'lilac', 'blue'])
const VIDEO_EXT_RE = /\.(mp4|mov|webm|m4v|mkv|avi|ogv|3gp)$/i
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024 * 1024

const dataDir = process.env.DATA_DIR || join(process.cwd(), 'data')
const uploadsDir = join(dataDir, 'uploads')
const hlsDir = join(dataDir, 'hls')
const thumbsDir = join(dataDir, 'thumbs')
const clipsFile = join(dataDir, 'clips.json')
const usersFile = join(dataDir, 'users.json')

await Promise.all([
  mkdir(uploadsDir, { recursive: true }),
  mkdir(hlsDir, { recursive: true }),
  mkdir(thumbsDir, { recursive: true })
])
if (!existsSync(clipsFile)) await writeFile(clipsFile, '[]\n')
if (!existsSync(usersFile)) await writeFile(usersFile, '[]\n')

// Serialize local JSON mutations to prevent concurrent FFmpeg workers from overwriting each other.
let localWriteChain = Promise.resolve()
function withLocalLock(fn) {
  const next = localWriteChain.then(fn, fn)
  localWriteChain = next.catch(() => {})
  return next
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ext = extname(file.originalname).toLowerCase() || '.mp4'
    cb(null, `${randomUUID()}${ext}`)
  }
})

const upload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (_req, file, cb) => {
    const allowed = file.mimetype.startsWith('video/') || VIDEO_EXT_RE.test(file.originalname)
    cb(null, allowed)
  }
})

// --- Formatting & Color Utilities ---

function prettyTitle(name) {
  const cleaned = basename(name, extname(name))
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned) return 'Untitled Clip'
  return cleaned.replace(/\b\w/g, char => char.toUpperCase()).slice(0, 120)
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0))
  const hours = Math.floor(total / 3600)
  const mins = Math.floor((total % 3600) / 60)
  const secs = total % 60
  if (hours > 0) {
    return `${hours}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
}

function parseDurationSeconds(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') return null
  const parts = value.split(':').map(Number)
  if (parts.some(n => !Number.isFinite(n))) return null
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  return null
}

function rgbToHsl(r, g, b) {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  let h = 0
  let s = 0
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6
    else if (max === gn) h = ((bn - rn) / d + 2) / 6
    else h = ((rn - gn) / d + 4) / 6
  }
  return [h * 360, s, l]
}

function hslToHex(h, s, l) {
  const hue2rgb = (p, q, t) => {
    let tt = t
    if (tt < 0) tt += 1
    if (tt > 1) tt -= 1
    if (tt < 1 / 6) return p + (q - p) * 6 * tt
    if (tt < 1 / 2) return q
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6
    return p
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const hn = (((h % 360) + 360) % 360) / 360
  const r = Math.round(hue2rgb(p, q, hn + 1 / 3) * 255)
  const g = Math.round(hue2rgb(p, q, hn) * 255)
  const b = Math.round(hue2rgb(p, q, hn - 1 / 3) * 255)
  return `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}`
}

function colorSignatureFromRgb(r, g, b) {
  const [h, s, l] = rgbToHsl(r, g, b)
  let tone = 'sage'
  if (s < 0.1) {
    tone = l > 0.48 ? 'sand' : 'sage'
  } else if (h >= 65 && h < 165) {
    tone = 'sage'
  } else if (h >= 165 && h < 255) {
    tone = 'blue'
  } else if (h >= 255 && h < 345) {
    tone = 'lilac'
  } else {
    tone = 'sand'
  }
  // Keep constellation node color luminous and harmonious on dark forest background.
  const clampedS = Math.min(0.56, Math.max(0.26, s))
  const clampedL = Math.min(0.76, Math.max(0.62, l))
  const accentColor = hslToHex(s < 0.08 ? (tone === 'sand' ? 40 : 95) : h, clampedS, clampedL)
  return { tone, accentColor }
}

// --- Security & Session Helpers ---

const sign = (value, expires) =>
  createHmac('sha256', secret).update(`${value}.${expires}`).digest('hex')

function safeHexEqual(actual, expected) {
  if (!actual || !expected || actual.length !== expected.length) return false
  try {
    return timingSafeEqual(Buffer.from(actual, 'utf8'), Buffer.from(expected, 'utf8'))
  } catch {
    return false
  }
}

const signedHlsUrl = (id, resource = 'master.m3u8', ttl = 3600) => {
  const expires = Math.floor(Date.now() / 1000) + ttl
  return `/api/videos/${id}/hls/${resource}?expires=${expires}&signature=${sign(`${id}/${resource}`, expires)}`
}

const signedThumbnailUrl = (id, ttl = 3600) => {
  const expires = Math.floor(Date.now() / 1000) + ttl
  return `/api/videos/${id}/thumbnail?expires=${expires}&signature=${sign(`${id}/thumb.jpg`, expires)}`
}

const verifySignature = (id, resource, query) => {
  const expires = Number(query.expires)
  if (!Number.isFinite(expires) || expires < Math.floor(Date.now() / 1000)) return false
  const signature = String(query.signature || '')
  const expected = sign(`${id}/${resource}`, expires)
  return safeHexEqual(signature, expected)
}

const mimeFor = name => {
  if (name.endsWith('.m3u8')) return 'application/vnd.apple.mpegurl'
  if (name.endsWith('.m4s')) return 'video/iso.segment'
  if (name.endsWith('.mp4')) return 'video/mp4'
  return 'video/mp2t'
}

async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex')
  const hash = (await scrypt(password, salt, 64)).toString('hex')
  return `${salt}:${hash}`
}

async function checkPassword(password, stored) {
  const [salt, expected] = String(stored || '').split(':')
  if (!salt || !expected) return false
  const actual = (await scrypt(password, salt, 64)).toString('hex')
  return safeHexEqual(actual, expected)
}

const sessionCookieOptions = req => ({
  httpOnly: true,
  sameSite: 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000,
  secure: Boolean(req.secure)
})

function sessionToken(user) {
  const payload = Buffer.from(
    JSON.stringify({ id: user.id, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7 })
  ).toString('base64url')
  return `${payload}.${sign(payload, 'session')}`
}

function parseCookies(header) {
  const result = {}
  for (const part of String(header || '').split(';')) {
    const trimmed = part.trim()
    const eqIndex = trimmed.indexOf('=')
    if (eqIndex > 0) {
      const key = trimmed.slice(0, eqIndex).trim()
      const value = trimmed.slice(eqIndex + 1).trim()
      result[key] = value
    }
  }
  return result
}

const publicUser = user => ({
  id: user.id,
  name: user.name,
  email: user.email,
  createdAt: user.createdAt
})

async function readUsers() {
  return JSON.parse(await readFile(usersFile, 'utf8'))
}

async function saveUsers(users) {
  await writeFile(usersFile, `${JSON.stringify(users, null, 2)}\n`)
}

async function sessionUser(req) {
  const cookies = parseCookies(req.headers.cookie)
  const token = cookies.afterframe_session
  if (!token) return null
  const [payload, signature] = token.split('.')
  if (!payload || !signature || !safeHexEqual(signature, sign(payload, 'session'))) return null
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString())
    if (!data.exp || data.exp < Math.floor(Date.now() / 1000)) return null
    if (supabase) {
      const { data: result, error } = await supabase.auth.admin.getUserById(data.id)
      if (error || !result.user) return null
      return {
        id: result.user.id,
        name: result.user.user_metadata?.name || result.user.email?.split('@')[0] || 'Member',
        email: result.user.email,
        createdAt: result.user.created_at
      }
    }
    const users = await readUsers()
    return users.find(user => user.id === data.id) || null
  } catch {
    return null
  }
}

async function requireUser(req, res, next) {
  try {
    const user = await sessionUser(req)
    if (!user) return res.status(401).json({ error: 'Sign in required.' })
    req.user = user
    next()
  } catch (error) {
    next(error)
  }
}

// --- Clip Data Layer (Local JSON or Supabase Postgres) ---

function toClip(row) {
  const durationSeconds = row.duration_seconds != null ? Number(row.duration_seconds) : null
  return {
    id: row.id,
    ownerId: row.owner_id,
    title: row.title,
    originalName: row.original_name,
    uploadedAt: row.created_at,
    duration: durationSeconds != null ? formatDuration(durationSeconds) : 'Preparing',
    durationSeconds,
    size: Number(row.size_bytes),
    category: row.category || 'Moments',
    status: row.status,
    processing: {
      stage: row.processing_stage || 'Queued',
      progress: Number(row.processing_progress || 0)
    },
    tone: row.tone || 'sage',
    accentColor: row.accent_color || undefined,
    file: row.original_path,
    mimeType: row.mime_type,
    shareToken: row.share_token,
    hlsReady: row.status === 'Ready',
    hlsPath: row.hls_path || undefined,
    thumbnailPath: row.thumbnail_path || undefined,
    thumbnailReady: Boolean(row.thumbnail_path),
    deletedAt: row.deleted_at || undefined
  }
}

function toRow(clip) {
  const durationSeconds =
    clip.durationSeconds != null ? clip.durationSeconds : parseDurationSeconds(clip.duration)
  return {
    id: clip.id,
    owner_id: clip.ownerId,
    title: clip.title,
    original_name: clip.originalName,
    category: clip.category || 'Moments',
    tone: clip.tone || 'sage',
    accent_color: clip.accentColor || null,
    size_bytes: clip.size,
    duration_seconds: durationSeconds,
    mime_type: clip.mimeType,
    original_path: clip.file,
    hls_path: clip.hlsPath || null,
    thumbnail_path: clip.thumbnailPath || null,
    status: clip.status,
    processing_stage: clip.processing?.stage || 'Queued',
    processing_progress: clip.processing?.progress ?? 0,
    share_token: clip.shareToken,
    deleted_at: clip.deletedAt || null,
    created_at: clip.uploadedAt
  }
}

async function readLocalClips() {
  return JSON.parse(await readFile(clipsFile, 'utf8'))
}

async function writeLocalClips(clips) {
  await writeFile(clipsFile, `${JSON.stringify(clips, null, 2)}\n`)
}

async function listClipsByOwner(ownerId, { trashed = false } = {}) {
  if (!supabase) {
    const clips = await readLocalClips()
    return clips
      .filter(clip => clip.ownerId === ownerId && (trashed ? Boolean(clip.deletedAt) : !clip.deletedAt))
      .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime())
  }
  let query = supabase
    .from('videos')
    .select('*')
    .eq('owner_id', ownerId)
    .order('created_at', { ascending: false })
  query = trashed ? query.not('deleted_at', 'is', null) : query.is('deleted_at', null)
  const { data, error } = await query
  if (error) throw error
  return data.map(toClip)
}

async function getClipById(id) {
  if (!supabase) {
    const clips = await readLocalClips()
    return clips.find(clip => clip.id === id) || null
  }
  const { data, error } = await supabase.from('videos').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  return data ? toClip(data) : null
}

async function getClipByShareToken(token) {
  if (!supabase) {
    const clips = await readLocalClips()
    return clips.find(clip => clip.shareToken === token && !clip.deletedAt) || null
  }
  const { data, error } = await supabase
    .from('videos')
    .select('*')
    .eq('share_token', token)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) throw error
  return data ? toClip(data) : null
}

async function insertClips(newClips) {
  if (!supabase) {
    return withLocalLock(async () => {
      const clips = await readLocalClips()
      await writeLocalClips([...newClips, ...clips])
      return newClips
    })
  }
  const { error } = await supabase.from('videos').insert(newClips.map(toRow))
  if (error) throw error
  return newClips
}

async function updateClip(id, patch) {
  if (!supabase) {
    return withLocalLock(async () => {
      const clips = await readLocalClips()
      const index = clips.findIndex(clip => clip.id === id)
      if (index < 0) return null
      const next = { ...clips[index], ...patch }
      if ('deletedAt' in patch && patch.deletedAt === undefined) {
        delete next.deletedAt
      }
      clips[index] = next
      await writeLocalClips(clips)
      return next
    })
  }
  const existing = await getClipById(id)
  if (!existing) return null
  const merged = { ...existing, ...patch }
  if ('deletedAt' in patch && patch.deletedAt === undefined) {
    delete merged.deletedAt
  }
  const { data, error } = await supabase
    .from('videos')
    .update(toRow(merged))
    .eq('id', id)
    .select('*')
    .single()
  if (error) throw error
  return toClip(data)
}

async function permanentlyRemoveClipRecord(id) {
  if (!supabase) {
    return withLocalLock(async () => {
      const clips = await readLocalClips()
      const index = clips.findIndex(clip => clip.id === id)
      if (index < 0) return null
      const [removed] = clips.splice(index, 1)
      await writeLocalClips(clips)
      return removed
    })
  }
  const existing = await getClipById(id)
  if (!existing) return null
  const { error } = await supabase.from('videos').delete().eq('id', id)
  if (error) throw error
  return existing
}

// --- Supabase Storage Helpers ---

function cloudOriginalKey(clip) {
  return `${clip.ownerId}/${clip.id}/${clip.file}`
}

function cloudThumbnailKey(clip) {
  return `${clip.ownerId}/${clip.id}/thumb.jpg`
}

function cloudHlsKey(clip, resource) {
  return `${clip.ownerId}/${clip.id}/hls/${resource}`
}

async function uploadToCloud(objectPath, localPath, contentType) {
  if (!supabase || !existsSync(localPath)) return
  const buffer = await readFile(localPath)
  const { error } = await supabase.storage
    .from(cloudBucket)
    .upload(objectPath, buffer, { contentType, upsert: true })
  if (error) throw error
}

async function downloadFromCloud(objectPath, localCachePath) {
  if (!supabase) return false
  const { data, error } = await supabase.storage.from(cloudBucket).download(objectPath)
  if (error || !data) return false
  await mkdir(join(localCachePath, '..'), { recursive: true })
  const buffer = Buffer.from(await data.arrayBuffer())
  await writeFile(localCachePath, buffer)
  return true
}

async function removeCloudAssets(clip) {
  if (!supabase) return
  try {
    const rootPrefix = `${clip.ownerId}/${clip.id}`
    const hlsPrefix = `${rootPrefix}/hls`
    const [rootList, hlsList] = await Promise.all([
      supabase.storage.from(cloudBucket).list(rootPrefix),
      supabase.storage.from(cloudBucket).list(hlsPrefix)
    ])
    const toDelete = []
    for (const item of rootList.data || []) {
      if (item.name && item.id) toDelete.push(`${rootPrefix}/${item.name}`)
    }
    for (const item of hlsList.data || []) {
      if (item.name && item.id) toDelete.push(`${hlsPrefix}/${item.name}`)
    }
    if (toDelete.length) {
      await supabase.storage.from(cloudBucket).remove(toDelete)
    }
  } catch (error) {
    console.error(`Failed cleaning cloud assets for ${clip.id}:`, error)
  }
}

async function removeLocalAssets(clip) {
  const targets = [
    join(uploadsDir, clip.file),
    join(thumbsDir, `${clip.id}.jpg`),
    join(hlsDir, clip.id)
  ]
  await Promise.all(targets.map(target => rm(target, { recursive: true, force: true }).catch(() => {})))
}

// --- FFmpeg Media Processing ---

let ffmpegAvailable = false
try {
  await exec('ffmpeg', ['-version'])
  ffmpegAvailable = true
} catch {
  ffmpegAvailable = false
}

async function generateThumbnailAndColor(clip, inputPath, durationSeconds = 0) {
  const thumbPath = join(thumbsDir, `${clip.id}.jpg`)
  const seekSeconds = durationSeconds > 1.5 ? Math.min(durationSeconds * 0.18, 4) : 0
  try {
    await exec('ffmpeg', [
      '-y',
      '-ss',
      String(seekSeconds.toFixed(2)),
      '-i',
      inputPath,
      '-frames:v',
      '1',
      '-vf',
      "scale='min(720,iw)':-2",
      '-q:v',
      '3',
      thumbPath
    ])
  } catch {
    // Fallback to frame 0 for very short or non-seekable streams.
    await exec('ffmpeg', [
      '-y',
      '-i',
      inputPath,
      '-frames:v',
      '1',
      '-vf',
      "scale='min(720,iw)':-2",
      '-q:v',
      '3',
      thumbPath
    ]).catch(() => {})
  }

  if (!existsSync(thumbPath)) return { thumbnailReady: false }

  let signature = { tone: clip.tone || 'sage', accentColor: clip.accentColor }
  try {
    const { stdout } = await exec(
      'ffmpeg',
      ['-v', 'error', '-i', thumbPath, '-vf', 'scale=1:1:flags=area', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'],
      { encoding: 'buffer', maxBuffer: 1024 * 1024 }
    )
    if (stdout && stdout.length >= 3) {
      signature = colorSignatureFromRgb(stdout[0], stdout[1], stdout[2])
    }
  } catch {
    // Keep existing tone if color extraction fails.
  }

  return { thumbnailReady: true, thumbPath, ...signature }
}

const activeJobs = new Set()

async function processVideo(clip) {
  if (activeJobs.has(clip.id)) return
  activeJobs.add(clip.id)
  const outputDir = join(hlsDir, clip.id)
  const inputPath = join(uploadsDir, clip.file)
  try {
    await updateClip(clip.id, {
      status: 'Processing',
      processing: { stage: 'Analyzing video', progress: 12 },
      error: undefined
    })

    if (!existsSync(inputPath) && supabase) {
      await downloadFromCloud(cloudOriginalKey(clip), inputPath)
    }
    if (!existsSync(inputPath)) {
      throw new Error('Original video file is missing.')
    }

    await mkdir(outputDir, { recursive: true })

    // 1. Probe metadata (duration, dimensions, codecs & audio stream presence)
    const probe = await exec('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration:stream=codec_type,codec_name,width,height,pix_fmt:stream_tags=rotate:stream_side_data=rotation',
      '-of',
      'json',
      inputPath
    ])
    const meta = JSON.parse(probe.stdout || '{}')
    const durationSeconds = Number(meta.format?.duration) || 0
    const streams = Array.isArray(meta.streams) ? meta.streams : []
    const videoStream = streams.find(s => s.codec_type === 'video')
    const audioStream = streams.find(s => s.codec_type === 'audio')
    const hasAudio = Boolean(audioStream)
    const rawRotation = Number(
      videoStream?.tags?.rotate ??
        videoStream?.side_data_list?.find(d => d.rotation != null)?.rotation ??
        0
    )
    const rotated = Math.abs(rawRotation) === 90 || Math.abs(rawRotation) === 270
    const rawWidth = Number(videoStream?.width) || null
    const rawHeight = Number(videoStream?.height) || null
    const width = rotated ? rawHeight : rawWidth
    const height = rotated ? rawWidth : rawHeight

    // 2. Extract poster thumbnail + color signature
    const thumbResult = await generateThumbnailAndColor(clip, inputPath, durationSeconds)
    const thumbPatch = thumbResult.thumbnailReady
      ? {
          thumbnailReady: true,
          thumbnailPath: `${clip.ownerId}/${clip.id}/thumb.jpg`,
          tone: thumbResult.tone,
          accentColor: thumbResult.accentColor
        }
      : {}

    // Clear any stale HLS files before writing new segments
    await rm(outputDir, { recursive: true, force: true }).catch(() => {})
    await mkdir(outputDir, { recursive: true })

    // 3. Fast lossless fMP4 HLS remux when already H.264 (yuv420p) + AAC (or silent),
    //    preserving exact original video size, bitrate, and dimensions.
    const canStreamCopy =
      videoStream?.codec_name === 'h264' &&
      videoStream?.pix_fmt === 'yuv420p' &&
      rawWidth &&
      rawHeight &&
      rawWidth % 2 === 0 &&
      rawHeight % 2 === 0 &&
      (!hasAudio || audioStream?.codec_name === 'aac')

    await updateClip(clip.id, {
      duration: formatDuration(durationSeconds),
      durationSeconds,
      width,
      height,
      ...thumbPatch,
      processing: {
        stage: canStreamCopy ? 'Packaging lossless HLS' : 'Transcoding & packaging HLS',
        progress: 48
      }
    })

    const fmp4Args = [
      '-hls_time',
      '6',
      '-hls_playlist_type',
      'vod',
      '-hls_flags',
      'independent_segments',
      '-hls_segment_type',
      'fmp4',
      '-hls_fmp4_init_filename',
      'init.mp4',
      '-hls_segment_filename',
      join(outputDir, 'segment-%03d.m4s'),
      join(outputDir, 'master.m3u8')
    ]

    const ffmpegArgs = canStreamCopy
      ? ['-y', '-i', inputPath, '-c', 'copy', ...fmp4Args]
      : [
          '-y',
          '-i',
          inputPath,
          '-vf',
          'scale=trunc(iw/2)*2:trunc(ih/2)*2',
          '-c:v',
          'libx264',
          '-preset',
          'veryfast',
          '-crf',
          '21',
          '-pix_fmt',
          'yuv420p',
          ...(hasAudio ? ['-c:a', 'aac', '-b:a', '128k'] : ['-an']),
          ...fmp4Args
        ]
    await exec('ffmpeg', ffmpegArgs, { maxBuffer: 16 * 1024 * 1024 })

    // 4. Upload original, thumbnail, and HLS package to Supabase Storage if enabled
    if (supabase) {
      await updateClip(clip.id, {
        processing: { stage: 'Syncing to cloud storage', progress: 84 }
      })
      await uploadToCloud(cloudOriginalKey(clip), inputPath, clip.mimeType || 'video/mp4')
      if (thumbResult.thumbnailReady && thumbResult.thumbPath) {
        await uploadToCloud(cloudThumbnailKey(clip), thumbResult.thumbPath, 'image/jpeg')
      }
      const hlsFiles = await readdir(outputDir)
      for (const fileName of hlsFiles) {
        await uploadToCloud(
          cloudHlsKey(clip, fileName),
          join(outputDir, fileName),
          mimeFor(fileName)
        )
      }
    }

    await updateClip(clip.id, {
      status: 'Ready',
      processing: { stage: 'Complete', progress: 100 },
      hlsReady: true,
      hlsPath: `${clip.ownerId}/${clip.id}/hls`
    })
  } catch (error) {
    console.error(`Processing failed for ${clip.id}:`, error)
    await updateClip(clip.id, {
      status: 'Failed',
      processing: { stage: 'Failed', progress: 0 },
      error: 'The video could not be transcoded.'
    })
  } finally {
    activeJobs.delete(clip.id)
  }
}

async function recoverPendingWork() {
  if (!ffmpegAvailable) return
  try {
    const clips = supabase
      ? (await supabase.from('videos').select('*').is('deleted_at', null)).data?.map(toClip) || []
      : (await readLocalClips()).filter(clip => !clip.deletedAt)

    for (const clip of clips) {
      if (clip.status === 'Queued' || clip.status === 'Processing') {
        void processVideo(clip)
      } else if (clip.status === 'Ready') {
        const inputPath = join(uploadsDir, clip.file)
        const hasInitMp4 = existsSync(join(hlsDir, clip.id, 'init.mp4'))
        if (existsSync(inputPath) && (!hasInitMp4 || !clip.width || !clip.height)) {
          void processVideo(clip)
        } else if (existsSync(inputPath) && !existsSync(join(thumbsDir, `${clip.id}.jpg`))) {
          const durationSeconds = parseDurationSeconds(clip.duration) || 0
          const res = await generateThumbnailAndColor(clip, inputPath, durationSeconds)
          if (res.thumbnailReady) {
            await updateClip(clip.id, {
              thumbnailReady: true,
              thumbnailPath: `${clip.ownerId}/${clip.id}/thumb.jpg`,
              tone: res.tone,
              accentColor: res.accentColor
            })
          }
        }
      }
    }
  } catch (error) {
    console.error('Startup recovery skipped:', error.message)
  }
}

function serializeClip(clip) {
  const hasThumb = Boolean(clip.thumbnailReady || existsSync(join(thumbsDir, `${clip.id}.jpg`)))
  return {
    ...clip,
    thumbnailReady: hasThumb,
    thumbnailUrl: hasThumb ? `/api/videos/${clip.id}/thumbnail` : null
  }
}

// --- Express Middleware & Routes ---

app.use(express.json())

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'afterframe-storage',
    storage: supabase ? 'supabase' : 'local',
    hls: true,
    ffmpeg: ffmpegAvailable,
    activeJobs: activeJobs.size
  })
})

// --- Auth Routes ---

app.get('/api/auth/me', async (req, res, next) => {
  try {
    const user = await sessionUser(req)
    res.json({ user: user ? publicUser(user) : null })
  } catch (error) {
    next(error)
  }
})

app.post('/api/auth/register', async (req, res, next) => {
  try {
    const { name, email, password } = req.body || {}
    const cleanName = String(name || '').trim().slice(0, 80)
    const normalizedEmail = String(email || '').trim().toLowerCase()
    const rawPassword = String(password || '')

    if (!cleanName || !/^\S+@\S+\.\S+$/.test(normalizedEmail) || rawPassword.length < 8) {
      return res.status(400).json({
        error: 'Use a name, valid email, and password with at least 8 characters.'
      })
    }

    if (supabase) {
      const { data, error } = await supabase.auth.admin.createUser({
        email: normalizedEmail,
        password: rawPassword,
        email_confirm: true,
        user_metadata: { name: cleanName }
      })
      if (error) {
        const status = /already|exists|registered/i.test(error.message) ? 409 : 400
        return res.status(status).json({ error: error.message })
      }
      const user = {
        id: data.user.id,
        name: data.user.user_metadata?.name || cleanName,
        email: data.user.email,
        createdAt: data.user.created_at
      }
      res.cookie('afterframe_session', sessionToken(user), sessionCookieOptions(req))
      return res.status(201).json({ user: publicUser(user) })
    }

    const result = await withLocalLock(async () => {
      const users = await readUsers()
      if (users.some(user => user.email === normalizedEmail)) return null
      const user = {
        id: randomUUID(),
        name: cleanName,
        email: normalizedEmail,
        passwordHash: await hashPassword(rawPassword),
        createdAt: new Date().toISOString()
      }
      await saveUsers([...users, user])
      return user
    })

    if (!result) {
      return res.status(409).json({ error: 'An account already exists for that email.' })
    }

    res.cookie('afterframe_session', sessionToken(result), sessionCookieOptions(req))
    res.status(201).json({ user: publicUser(result) })
  } catch (error) {
    next(error)
  }
})

app.post('/api/auth/login', async (req, res, next) => {
  try {
    const { email, password } = req.body || {}
    const normalizedEmail = String(email || '').trim().toLowerCase()
    const rawPassword = String(password || '')

    if (supabase) {
      const authClient = createAuthClient()
      const { data, error } = await authClient.auth.signInWithPassword({
        email: normalizedEmail,
        password: rawPassword
      })
      if (error || !data.user) {
        return res.status(401).json({ error: 'Incorrect email or password.' })
      }
      const user = {
        id: data.user.id,
        name: data.user.user_metadata?.name || data.user.email.split('@')[0],
        email: data.user.email,
        createdAt: data.user.created_at
      }
      res.cookie('afterframe_session', sessionToken(user), sessionCookieOptions(req))
      return res.json({ user: publicUser(user) })
    }

    const users = await readUsers()
    const user = users.find(item => item.email === normalizedEmail)
    if (!user || !(await checkPassword(rawPassword, user.passwordHash))) {
      return res.status(401).json({ error: 'Incorrect email or password.' })
    }
    res.cookie('afterframe_session', sessionToken(user), sessionCookieOptions(req))
    res.json({ user: publicUser(user) })
  } catch (error) {
    next(error)
  }
})

app.patch('/api/auth/profile', requireUser, async (req, res, next) => {
  try {
    const name = String(req.body?.name || '').trim()
    if (!name || name.length > 80) {
      return res.status(400).json({ error: 'Choose a name between 1 and 80 characters.' })
    }

    if (supabase) {
      const { data, error } = await supabase.auth.admin.updateUserById(req.user.id, {
        user_metadata: { name }
      })
      if (error || !data.user) {
        return res.status(500).json({ error: 'Could not update profile.' })
      }
      const updated = {
        id: data.user.id,
        name: data.user.user_metadata?.name || name,
        email: data.user.email,
        createdAt: data.user.created_at
      }
      res.cookie('afterframe_session', sessionToken(updated), sessionCookieOptions(req))
      return res.json({ user: publicUser(updated) })
    }

    const updated = await withLocalLock(async () => {
      const users = await readUsers()
      const index = users.findIndex(user => user.id === req.user.id)
      if (index < 0) return null
      users[index] = { ...users[index], name }
      await saveUsers(users)
      return users[index]
    })

    if (!updated) return res.status(404).json({ error: 'Account not found.' })
    res.cookie('afterframe_session', sessionToken(updated), sessionCookieOptions(req))
    res.json({ user: publicUser(updated) })
  } catch (error) {
    next(error)
  }
})

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('afterframe_session', {
    httpOnly: true,
    sameSite: 'lax',
    secure: Boolean(req.secure)
  })
  res.status(204).end()
})

// --- Video Library Routes ---

app.get('/api/videos', requireUser, async (req, res, next) => {
  try {
    const clips = await listClipsByOwner(req.user.id, { trashed: false })
    res.json(clips.map(serializeClip))
  } catch (error) {
    next(error)
  }
})

app.get('/api/trash', requireUser, async (req, res, next) => {
  try {
    const clips = await listClipsByOwner(req.user.id, { trashed: true })
    res.json(clips.map(serializeClip))
  } catch (error) {
    next(error)
  }
})

app.post('/api/videos', requireUser, upload.array('videos', 20), async (req, res, next) => {
  try {
    const files = req.files || []
    if (!files.length) {
      return res.status(400).json({ error: 'Choose at least one supported video file.' })
    }
    const requestedCategory = String(req.body?.category || 'Moments')
    const category = VALID_CATEGORIES.has(requestedCategory) ? requestedCategory : 'Moments'
    const tones = ['sage', 'sand', 'lilac', 'blue']

    const created = files.map((file, index) => ({
      id: randomUUID(),
      ownerId: req.user.id,
      title: prettyTitle(file.originalname),
      originalName: file.originalname,
      uploadedAt: new Date().toISOString(),
      duration: 'Preparing',
      durationSeconds: null,
      size: file.size,
      category,
      status: 'Queued',
      processing: { stage: 'Queued', progress: 0 },
      tone: tones[index % tones.length],
      file: file.filename,
      mimeType: file.mimetype || 'video/mp4',
      shareToken: randomUUID().replaceAll('-', '').slice(0, 20),
      hlsReady: false,
      thumbnailReady: false
    }))

    await insertClips(created)
    created.forEach(clip => void processVideo(clip))
    res.status(201).json(created.map(serializeClip))
  } catch (error) {
    next(error)
  }
})

app.get('/api/videos/:id', requireUser, async (req, res, next) => {
  try {
    const clip = await getClipById(req.params.id)
    if (!clip || clip.ownerId !== req.user.id) {
      return res.status(404).json({ error: 'Video not found.' })
    }
    res.json({
      ...serializeClip(clip),
      playbackUrl: clip.hlsReady ? signedHlsUrl(clip.id) : null
    })
  } catch (error) {
    next(error)
  }
})

app.patch('/api/videos/:id', requireUser, async (req, res, next) => {
  try {
    const clip = await getClipById(req.params.id)
    if (!clip || clip.ownerId !== req.user.id || clip.deletedAt) {
      return res.status(404).json({ error: 'Video not found.' })
    }

    const patch = {}
    if (req.body?.title !== undefined) {
      const title = String(req.body.title).trim()
      if (!title || title.length > 120) {
        return res.status(400).json({ error: 'Title must be between 1 and 120 characters.' })
      }
      patch.title = title
    }
    if (req.body?.category !== undefined) {
      const category = String(req.body.category)
      if (!VALID_CATEGORIES.has(category)) {
        return res.status(400).json({ error: 'Invalid category.' })
      }
      patch.category = category
    }
    if (req.body?.tone !== undefined) {
      const tone = String(req.body.tone)
      if (!VALID_TONES.has(tone)) {
        return res.status(400).json({ error: 'Invalid color tone.' })
      }
      patch.tone = tone
    }

    if (!Object.keys(patch).length) {
      return res.status(400).json({ error: 'No valid fields provided to update.' })
    }

    const updated = await updateClip(clip.id, patch)
    res.json(serializeClip(updated))
  } catch (error) {
    next(error)
  }
})

app.post('/api/videos/:id/retry', requireUser, async (req, res, next) => {
  try {
    const clip = await getClipById(req.params.id)
    if (!clip || clip.ownerId !== req.user.id || clip.deletedAt) {
      return res.status(404).json({ error: 'Video not found.' })
    }
    const reset = await updateClip(clip.id, {
      status: 'Queued',
      processing: { stage: 'Queued', progress: 0 },
      error: undefined
    })
    void processVideo(reset)
    res.json(serializeClip(reset))
  } catch (error) {
    next(error)
  }
})

app.get('/api/videos/:id/playback', requireUser, async (req, res, next) => {
  try {
    const clip = await getClipById(req.params.id)
    if (!clip || clip.ownerId !== req.user.id || clip.deletedAt) {
      return res.status(404).json({ error: 'Video not found.' })
    }
    if (clip.status === 'Failed') {
      return res.json({
        url: `/api/videos/${clip.id}/original`,
        expiresIn: 3600,
        fallback: true
      })
    }
    if (!clip.hlsReady) {
      return res.status(409).json({
        error: 'Video is still processing.',
        processing: clip.processing
      })
    }
    res.json({ url: signedHlsUrl(clip.id), expiresIn: 3600 })
  } catch (error) {
    next(error)
  }
})

app.get('/api/videos/:id/hls/:resource', async (req, res, next) => {
  try {
    const { id, resource } = req.params
    if (
      !/^(master\.m3u8|init\.mp4|segment-\d{3,5}\.(ts|m4s))$/.test(resource) ||
      !verifySignature(id, resource, req.query)
    ) {
      return res.status(403).json({ error: 'Playback link expired or is invalid.' })
    }

    const localPath = join(hlsDir, id, resource)
    if (!existsSync(localPath)) {
      if (supabase) {
        const clip = await getClipById(id)
        if (!clip || clip.deletedAt) {
          return res.status(404).json({ error: 'Stream not found.' })
        }
        const ok = await downloadFromCloud(cloudHlsKey(clip, resource), localPath)
        if (!ok) return res.status(404).json({ error: 'Stream not ready.' })
      } else {
        return res.status(404).json({ error: 'Stream not ready.' })
      }
    }

    if (resource === 'master.m3u8') {
      let playlist = await readFile(localPath, 'utf8')
      playlist = playlist
        .replace(/URI="init\.mp4"/g, () => `URI="${signedHlsUrl(id, 'init.mp4')}"`)
        .replace(/segment-\d{3,5}\.(ts|m4s)/g, segment => signedHlsUrl(id, segment))
      res.setHeader('Cache-Control', 'private, max-age=60')
      return res.type(mimeFor(resource)).send(playlist)
    }

    res.setHeader('Cache-Control', 'private, max-age=3600')
    res.type(mimeFor(resource)).sendFile(localPath)
  } catch (error) {
    next(error)
  }
})

app.get('/api/videos/:id/thumbnail', async (req, res, next) => {
  try {
    const { id } = req.params
    const clip = await getClipById(id)
    if (!clip) return res.status(404).json({ error: 'Thumbnail not found.' })

    const signedOk = verifySignature(id, 'thumb.jpg', req.query)
    if (!signedOk) {
      const user = await sessionUser(req)
      if (!user || user.id !== clip.ownerId) {
        return res.status(403).json({ error: 'Access denied.' })
      }
    }

    const localPath = join(thumbsDir, `${id}.jpg`)
    if (!existsSync(localPath)) {
      if (supabase) {
        const ok = await downloadFromCloud(cloudThumbnailKey(clip), localPath)
        if (!ok) return res.status(404).json({ error: 'Thumbnail not ready.' })
      } else {
        return res.status(404).json({ error: 'Thumbnail not ready.' })
      }
    }

    res.setHeader('Cache-Control', 'private, max-age=3600')
    res.type('image/jpeg').sendFile(localPath)
  } catch (error) {
    next(error)
  }
})

app.get('/api/videos/:id/original', requireUser, async (req, res, next) => {
  try {
    const clip = await getClipById(req.params.id)
    if (!clip || clip.ownerId !== req.user.id) {
      return res.status(404).json({ error: 'Video not found.' })
    }

    const localPath = join(uploadsDir, clip.file)
    if (!existsSync(localPath)) {
      if (supabase) {
        const ok = await downloadFromCloud(cloudOriginalKey(clip), localPath)
        if (!ok) return res.status(404).json({ error: 'Original file unavailable.' })
      } else {
        return res.status(404).json({ error: 'Original file unavailable.' })
      }
    }

    if (req.query.download === '1') {
      const safeName = (clip.originalName || `${clip.title}.mp4`).replace(/["\r\n]/g, '')
      res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`)
    }
    res.type(clip.mimeType || 'video/mp4').sendFile(localPath)
  } catch (error) {
    next(error)
  }
})

app.delete('/api/videos/:id', requireUser, async (req, res, next) => {
  try {
    const clip = await getClipById(req.params.id)
    if (!clip || clip.ownerId !== req.user.id || clip.deletedAt) {
      return res.status(404).json({ error: 'Video not found.' })
    }
    await updateClip(clip.id, { deletedAt: new Date().toISOString() })
    res.status(204).end()
  } catch (error) {
    next(error)
  }
})

app.post('/api/videos/:id/restore', requireUser, async (req, res, next) => {
  try {
    const clip = await getClipById(req.params.id)
    if (!clip || clip.ownerId !== req.user.id || !clip.deletedAt) {
      return res.status(404).json({ error: 'Video not found in trash.' })
    }
    const restored = await updateClip(clip.id, { deletedAt: undefined })
    res.json(serializeClip(restored))
  } catch (error) {
    next(error)
  }
})

app.delete('/api/videos/:id/permanent', requireUser, async (req, res, next) => {
  try {
    const clip = await getClipById(req.params.id)
    if (!clip || clip.ownerId !== req.user.id || !clip.deletedAt) {
      return res.status(404).json({ error: 'Video not found in trash.' })
    }
    await permanentlyRemoveClipRecord(clip.id)
    await Promise.all([removeLocalAssets(clip), removeCloudAssets(clip)])
    res.status(204).end()
  } catch (error) {
    next(error)
  }
})

// --- Public Share Route ---

app.get('/api/share/:token', async (req, res, next) => {
  try {
    const clip = await getClipByShareToken(req.params.token)
    if (!clip) {
      return res.status(404).json({ error: 'Shared video not found.' })
    }
    const hasThumb = Boolean(clip.thumbnailReady || existsSync(join(thumbsDir, `${clip.id}.jpg`)))
    res.json({
      id: clip.id,
      title: clip.title,
      category: clip.category,
      duration: clip.duration,
      size: clip.size,
      uploadedAt: clip.uploadedAt,
      tone: clip.tone,
      accentColor: clip.accentColor,
      status: clip.status,
      processing: clip.processing,
      thumbnailUrl: hasThumb ? signedThumbnailUrl(clip.id) : null,
      playbackUrl: clip.hlsReady ? signedHlsUrl(clip.id) : null
    })
  } catch (error) {
    next(error)
  }
})

// Return clean JSON 404 for unknown API paths.
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Endpoint not found.' })
})

const clientDir = join(process.cwd(), 'dist')
if (existsSync(clientDir)) {
  app.use(
    express.static(clientDir, {
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('sw.js') || filePath.endsWith('index.html')) {
          res.setHeader('Cache-Control', 'no-cache')
        }
      }
    })
  )
  app.get(/.*/, (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache')
    res.sendFile(join(clientDir, 'index.html'))
  })
}

app.use((error, _req, res, _next) => {
  console.error(error)
  if (error?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'Files must be 5 GB or smaller.' })
  }
  res.status(500).json({ error: 'Storage service error.' })
})

app.listen(port, host, () => {
  console.log(`Afterframe storage API listening on http://${host}:${port} (${supabase ? 'Supabase' : 'Local'})`)
  void recoverPendingWork()
})
