import express from 'express'
import multer from 'multer'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, extname, basename } from 'node:path'
import { randomUUID, createHmac, timingSafeEqual, randomBytes, scrypt as scryptCallback } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFile), scrypt = promisify(scryptCallback), app = express(), port = Number(process.env.PORT || 3001)
const secret = process.env.AFTERFRAME_SIGNING_SECRET || 'afterframe-local-development-secret'
const dataDir = process.env.DATA_DIR || join(process.cwd(), 'data'), uploadsDir = join(dataDir, 'uploads'), hlsDir = join(dataDir, 'hls'), clipsFile = join(dataDir, 'clips.json'), usersFile = join(dataDir, 'users.json')
await Promise.all([mkdir(uploadsDir, { recursive: true }), mkdir(hlsDir, { recursive: true })])
if (!existsSync(clipsFile)) await writeFile(clipsFile, '[]\n')
if (!existsSync(usersFile)) await writeFile(usersFile, '[]\n')
const storage = multer.diskStorage({ destination: (_req, _file, cb) => cb(null, uploadsDir), filename: (_req, file, cb) => cb(null, `${randomUUID()}${extname(file.originalname).toLowerCase()}`) })
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 * 1024 }, fileFilter: (_req, file, cb) => cb(null, file.mimetype.startsWith('video/')) })
const readClips = async () => JSON.parse(await readFile(clipsFile, 'utf8'))
const saveClips = async clips => writeFile(clipsFile, `${JSON.stringify(clips, null, 2)}\n`)
const readUsers = async () => JSON.parse(await readFile(usersFile, 'utf8'))
const saveUsers = async users => writeFile(usersFile, `${JSON.stringify(users, null, 2)}\n`)
const prettyTitle = name => basename(name, extname(name)).replace(/[-_]+/g, ' ').replace(/\b\w/g, char => char.toUpperCase())
const formatDuration = seconds => { const s = Math.max(0, Math.round(Number(seconds) || 0)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` }
const sign = (value, expires) => createHmac('sha256', secret).update(`${value}.${expires}`).digest('hex')
const signedUrl = (id, resource = 'master.m3u8', ttl = 3600) => { const expires = Math.floor(Date.now() / 1000) + ttl; return `/api/videos/${id}/hls/${resource}?expires=${expires}&signature=${sign(`${id}/${resource}`, expires)}` }
const verify = (id, resource, query) => { const expires = Number(query.expires), signature = String(query.signature || ''), expected = sign(`${id}/${resource}`, expires); return expires >= Math.floor(Date.now() / 1000) && signature.length === expected.length && timingSafeEqual(Buffer.from(signature), Buffer.from(expected)) }
const mimeFor = name => name.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t'
const hashPassword = async password => { const salt = randomBytes(16).toString('hex'); const hash = (await scrypt(password, salt, 64)).toString('hex'); return `${salt}:${hash}` }
const checkPassword = async (password, stored) => { const [salt, expected] = stored.split(':'); const actual = (await scrypt(password, salt, 64)).toString('hex'); return timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex')) }
const sessionToken = user => { const payload = Buffer.from(JSON.stringify({ id: user.id, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7 })).toString('base64url'); return `${payload}.${sign(payload, 'session')}` }
const sessionUser = async req => { const cookies = Object.fromEntries(String(req.headers.cookie || '').split(';').map(value => value.trim().split('='))); const token = cookies.afterframe_session; if (!token) return null; const [payload, signature] = token.split('.'); if (!payload || !signature || signature !== sign(payload, 'session')) return null; try { const data = JSON.parse(Buffer.from(payload, 'base64url').toString()); if (data.exp < Math.floor(Date.now() / 1000)) return null; return (await readUsers()).find(user => user.id === data.id) || null } catch { return null } }
const requireUser = async (req, res, next) => { const user = await sessionUser(req); if (!user) return res.status(401).json({ error: 'Sign in required.' }); req.user = user; next() }
const publicUser = user => ({ id: user.id, name: user.name, email: user.email, createdAt: user.createdAt })
async function updateClip(id, patch) { const clips = await readClips(), index = clips.findIndex(clip => clip.id === id); if (index < 0) return null; clips[index] = { ...clips[index], ...patch }; await saveClips(clips); return clips[index] }
async function processVideo(clip) {
  const outputDir = join(hlsDir, clip.id)
  try {
    await updateClip(clip.id, { status: 'Processing', processing: { stage: 'Transcoding', progress: 12 } }); await mkdir(outputDir, { recursive: true })
    const input = join(uploadsDir, clip.file), probe = await exec('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', input])
    await updateClip(clip.id, { duration: formatDuration(probe.stdout.trim()), processing: { stage: 'Packaging HLS', progress: 64 } })
    await exec('ffmpeg', ['-y', '-i', input, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-c:a', 'aac', '-b:a', '128k', '-hls_time', '6', '-hls_playlist_type', 'vod', '-hls_segment_filename', join(outputDir, 'segment-%03d.ts'), join(outputDir, 'master.m3u8')], { maxBuffer: 8 * 1024 * 1024 })
    await updateClip(clip.id, { status: 'Ready', processing: { stage: 'Complete', progress: 100 }, hlsReady: true })
  } catch (error) { console.error(`Processing failed for ${clip.id}`, error); await updateClip(clip.id, { status: 'Failed', processing: { stage: 'Failed', progress: 0 }, error: 'The video could not be transcoded.' }) }
}
app.use(express.json())
app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'afterframe-local-storage', hls: true }))
app.get('/api/auth/me', async (req, res, next) => { try { const user = await sessionUser(req); res.json({ user: user ? publicUser(user) : null }) } catch (error) { next(error) } })
app.post('/api/auth/register', async (req, res, next) => { try { const { name, email, password } = req.body || {}; const normalizedEmail = String(email || '').trim().toLowerCase(); if (!String(name || '').trim() || !/^\S+@\S+\.\S+$/.test(normalizedEmail) || String(password || '').length < 8) return res.status(400).json({ error: 'Use a name, valid email, and password with at least 8 characters.' }); const users = await readUsers(); if (users.some(user => user.email === normalizedEmail)) return res.status(409).json({ error: 'An account already exists for that email.' }); const user = { id: randomUUID(), name: String(name).trim().slice(0, 80), email: normalizedEmail, passwordHash: await hashPassword(String(password)), createdAt: new Date().toISOString() }; await saveUsers([...users, user]); res.cookie('afterframe_session', sessionToken(user), { httpOnly: true, sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000, secure: false }); res.status(201).json({ user: publicUser(user) }) } catch (error) { next(error) } })
app.post('/api/auth/login', async (req, res, next) => { try { const { email, password } = req.body || {}; const user = (await readUsers()).find(item => item.email === String(email || '').trim().toLowerCase()); if (!user || !(await checkPassword(String(password || ''), user.passwordHash))) return res.status(401).json({ error: 'Incorrect email or password.' }); res.cookie('afterframe_session', sessionToken(user), { httpOnly: true, sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000, secure: false }); res.json({ user: publicUser(user) }) } catch (error) { next(error) } })
app.post('/api/auth/logout', (_req, res) => { res.clearCookie('afterframe_session', { httpOnly: true, sameSite: 'lax', secure: false }); res.status(204).end() })
app.get('/api/videos', requireUser, async (req, res, next) => { try { res.json((await readClips()).filter(clip => clip.ownerId === req.user.id && !clip.deletedAt)) } catch (error) { next(error) } })
app.get('/api/trash', requireUser, async (req, res, next) => { try { res.json((await readClips()).filter(clip => clip.ownerId === req.user.id && clip.deletedAt)) } catch (error) { next(error) } })
app.post('/api/videos', requireUser, upload.array('videos', 20), async (req, res, next) => { try { const files = req.files || []; if (!files.length) return res.status(400).json({ error: 'Choose at least one video file.' }); const clips = await readClips(); const created = files.map((file, index) => ({ id: randomUUID(), ownerId: req.user.id, title: prettyTitle(file.originalname), originalName: file.originalname, uploadedAt: new Date().toISOString(), duration: 'Preparing', size: file.size, category: 'Moments', status: 'Queued', processing: { stage: 'Queued', progress: 0 }, tone: ['sage', 'sand', 'lilac', 'blue'][index % 4], file: file.filename, mimeType: file.mimetype, shareToken: randomUUID().replaceAll('-', '').slice(0, 20), hlsReady: false })); await saveClips([...created, ...clips]); created.forEach(processVideo); res.status(201).json(created) } catch (error) { next(error) } })
app.get('/api/videos/:id', requireUser, async (req, res, next) => { try { const clip = (await readClips()).find(item => item.id === req.params.id && item.ownerId === req.user.id); if (!clip) return res.status(404).json({ error: 'Video not found.' }); res.json({ ...clip, playbackUrl: clip.hlsReady ? signedUrl(clip.id) : null }) } catch (error) { next(error) } })
app.get('/api/videos/:id/playback', requireUser, async (req, res, next) => { try { const clip = (await readClips()).find(item => item.id === req.params.id && item.ownerId === req.user.id); if (!clip) return res.status(404).json({ error: 'Video not found.' }); if (!clip.hlsReady) return res.status(409).json({ error: 'Video is still processing.' }); res.json({ url: signedUrl(clip.id), expiresIn: 3600 }) } catch (error) { next(error) } })
app.get('/api/videos/:id/hls/:resource', async (req, res, next) => { try { const resource = req.params.resource; if (!/^(master\.m3u8|segment-\d{3}\.ts)$/.test(resource) || !verify(req.params.id, resource, req.query)) return res.status(403).json({ error: 'Playback link expired or is invalid.' }); const path = join(hlsDir, req.params.id, resource); if (!existsSync(path)) return res.status(404).json({ error: 'Stream not ready.' }); if (resource === 'master.m3u8') { let playlist = await readFile(path, 'utf8'); playlist = playlist.replace(/segment-\d{3}\.ts/g, segment => signedUrl(req.params.id, segment)); res.type(mimeFor(resource)).send(playlist) } else res.type(mimeFor(resource)).sendFile(path) } catch (error) { next(error) } })
app.get('/api/videos/:id/original', requireUser, async (req, res, next) => { try { const clip = (await readClips()).find(item => item.id === req.params.id && item.ownerId === req.user.id); if (!clip) return res.status(404).json({ error: 'Video not found.' }); res.type(clip.mimeType).sendFile(join(uploadsDir, clip.file)) } catch (error) { next(error) } })
app.delete('/api/videos/:id', requireUser, async (req, res, next) => { try { const clips = await readClips(), index = clips.findIndex(clip => clip.id === req.params.id && clip.ownerId === req.user.id && !clip.deletedAt); if (index < 0) return res.status(404).json({ error: 'Video not found.' }); clips[index] = { ...clips[index], deletedAt: new Date().toISOString() }; await saveClips(clips); res.status(204).end() } catch (error) { next(error) } })
app.post('/api/videos/:id/restore', requireUser, async (req, res, next) => { try { const clips = await readClips(), index = clips.findIndex(clip => clip.id === req.params.id && clip.ownerId === req.user.id && clip.deletedAt); if (index < 0) return res.status(404).json({ error: 'Video not found in trash.' }); delete clips[index].deletedAt; await saveClips(clips); res.json(clips[index]) } catch (error) { next(error) } })
app.get('/api/share/:token', async (req, res, next) => { try { const clip = (await readClips()).find(item => item.shareToken === req.params.token); if (!clip) return res.status(404).json({ error: 'Shared video not found.' }); res.json({ id: clip.id, title: clip.title, category: clip.category, status: clip.status, playbackUrl: clip.hlsReady ? signedUrl(clip.id) : null }) } catch (error) { next(error) } })
const clientDir = join(process.cwd(), 'dist')
if (existsSync(clientDir)) {
  app.use(express.static(clientDir))
  app.get(/.*/, (_req, res) => res.sendFile(join(clientDir, 'index.html')))
}
app.use((error, _req, res, _next) => { console.error(error); res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 500).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'Files must be 5 GB or smaller.' : 'Storage service error.' }) })
app.listen(port, process.env.HOST || '127.0.0.1', () => console.log(`Afterframe storage API listening on port ${port}`))
