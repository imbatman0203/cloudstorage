import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)

let dataDir
let sampleVideoPath
let serverProc
let baseUrl

function extractCookie(response) {
  const setCookie = response.headers.get('set-cookie')
  if (!setCookie) return ''
  return setCookie.split(';')[0]
}

async function waitForHealth(url, timeoutMs = 6000) {
  const deadline = Date.now() + timeoutMs
  let lastErr = null
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/api/health`)
      if (res.ok) return await res.json()
      lastErr = new Error(`HTTP ${res.status}`)
    } catch (err) {
      lastErr = err
    }
    await new Promise(resolve => setTimeout(resolve, 150))
  }
  throw new Error(`Server did not become healthy in time (last error: ${lastErr?.cause?.message || lastErr?.message || lastErr})`)
}

before(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'afterframe-test-'))
  sampleVideoPath = join(dataDir, 'sample-clip.mp4')

  // Generate a small 2-second test video with color + sine audio using FFmpeg
  await exec('ffmpeg', [
    '-y',
    '-f', 'lavfi', '-i', 'color=c=0x4a7a5c:s=320x180:d=2',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-shortest',
    sampleVideoPath
  ])

  const port = 3400 + Math.floor(Math.random() * 500)
  baseUrl = `http://127.0.0.1:${port}`

  let stderr = ''
  serverProc = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      DATA_DIR: dataDir,
      AFTERFRAME_SIGNING_SECRET: 'test-signing-secret-12345',
      SUPABASE_URL: '',
      SUPABASE_SERVICE_ROLE_KEY: ''
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  serverProc.stderr.on('data', chunk => { stderr += chunk.toString() })

  try {
    await waitForHealth(baseUrl)
  } catch (err) {
    throw new Error(`${err.message}\nServer stderr:\n${stderr}`)
  }
})

after(async () => {
  if (serverProc && !serverProc.killed) {
    serverProc.kill('SIGTERM')
    await new Promise(resolve => serverProc.once('exit', resolve))
  }
  if (dataDir) {
    await rm(dataDir, { recursive: true, force: true })
  }
})

describe('Afterframe API End-to-End', () => {
  let cookieA = ''
  let cookieB = ''
  let uploadedClip

  it('reports healthy local storage and FFmpeg availability', async () => {
    const res = await fetch(`${baseUrl}/api/health`)
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.ok, true)
    assert.equal(body.storage, 'local')
    assert.equal(body.hls, true)
    assert.equal(body.ffmpeg, true)
  })

  it('handles full auth lifecycle (register, duplicate check, profile edit, logout, login)', async () => {
    // Register User A
    const reg = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Alex Morgan',
        email: 'alex@afterframe.test',
        password: 'password123'
      })
    })
    assert.equal(reg.status, 201)
    cookieA = extractCookie(reg)
    assert.ok(cookieA.startsWith('afterframe_session='))
    const regBody = await reg.json()
    assert.equal(regBody.user.name, 'Alex Morgan')

    // Duplicate email rejected with 409
    const dup = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Alex Two',
        email: 'ALEX@afterframe.test',
        password: 'password123'
      })
    })
    assert.equal(dup.status, 409)

    // Profile update
    const patch = await fetch(`${baseUrl}/api/auth/profile`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: cookieA },
      body: JSON.stringify({ name: 'Alex M.' })
    })
    assert.equal(patch.status, 200)
    const patchBody = await patch.json()
    assert.equal(patchBody.user.name, 'Alex M.')

    // Wrong password rejected with 401
    const badLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'alex@afterframe.test', password: 'wrongpassword' })
    })
    assert.equal(badLogin.status, 401)

    // Valid login succeeds
    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'alex@afterframe.test', password: 'password123' })
    })
    assert.equal(login.status, 200)
    cookieA = extractCookie(login)

    // Register User B for isolation checks
    const regB = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Samira',
        email: 'samira@afterframe.test',
        password: 'password123'
      })
    })
    assert.equal(regB.status, 201)
    cookieB = extractCookie(regB)
  })

  it('uploads video, transcodes HLS, extracts thumbnail & color signature, and signs playback', async () => {
    const fileBytes = await readFile(sampleVideoPath)
    const form = new FormData()
    form.append('category', 'Travel')
    form.append('videos', new Blob([fileBytes], { type: 'video/mp4' }), 'morning-forest.mp4')

    const uploadRes = await fetch(`${baseUrl}/api/videos`, {
      method: 'POST',
      headers: { Cookie: cookieA },
      body: form
    })
    assert.equal(uploadRes.status, 201)
    const created = await uploadRes.json()
    assert.equal(created.length, 1)
    assert.equal(created[0].title, 'Morning Forest')
    assert.equal(created[0].category, 'Travel')
    const clipId = created[0].id

    // Wait for FFmpeg worker to finish
    let clip
    const deadline = Date.now() + 20000
    while (Date.now() < deadline) {
      const res = await fetch(`${baseUrl}/api/videos/${clipId}`, { headers: { Cookie: cookieA } })
      clip = await res.json()
      if (clip.status === 'Ready' || clip.status === 'Failed') break
      await new Promise(resolve => setTimeout(resolve, 250))
    }

    assert.equal(clip.status, 'Ready', `Expected Ready, got ${clip.status}`)
    assert.equal(clip.duration, '00:02')
    assert.equal(clip.thumbnailReady, true)
    assert.ok(clip.accentColor?.startsWith('#'))
    assert.equal(clip.tone, 'sage')
    uploadedClip = clip

    // Verify thumbnail endpoint works for owner
    const thumbRes = await fetch(`${baseUrl}/api/videos/${clipId}/thumbnail`, {
      headers: { Cookie: cookieA }
    })
    assert.equal(thumbRes.status, 200)
    assert.match(thumbRes.headers.get('content-type') || '', /image\/jpeg/)

    // Verify signed HLS playlist and segment
    const playRes = await fetch(`${baseUrl}/api/videos/${clipId}/playback`, {
      headers: { Cookie: cookieA }
    })
    assert.equal(playRes.status, 200)
    const { url: masterUrl } = await playRes.json()
    assert.ok(masterUrl.includes('signature='))

    const playlistRes = await fetch(`${baseUrl}${masterUrl}`)
    assert.equal(playlistRes.status, 200)
    const playlist = await playlistRes.text()
    assert.ok(playlist.includes('#EXTM3U'))
    const segMatch = playlist.match(/\/api\/videos\/[^\s"]+segment-\d+\.(ts|m4s)[^\s"]+/)
    assert.ok(segMatch, 'Expected signed segment URL in master playlist')
    const initMatch = playlist.match(/URI="(\/api\/videos\/[^"]+init\.mp4[^"]+)"/)
    if (initMatch) {
      const initRes = await fetch(`${baseUrl}${initMatch[1]}`)
      assert.equal(initRes.status, 200)
    }

    const segRes = await fetch(`${baseUrl}${segMatch[0]}`)
    assert.equal(segRes.status, 200)
    const segBuf = await segRes.arrayBuffer()
    assert.ok(segBuf.byteLength > 1000)

    // Tampered signature must return 403
    const tampered = await fetch(`${baseUrl}${masterUrl}0`)
    assert.equal(tampered.status, 403)
  })

  it('edits video metadata, downloads original, and enforces cross-user isolation', async () => {
    const patchRes = await fetch(`${baseUrl}/api/videos/${uploadedClip.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: cookieA },
      body: JSON.stringify({ title: 'Pine Ridge Dawn', category: 'Field notes' })
    })
    assert.equal(patchRes.status, 200)
    const updated = await patchRes.json()
    assert.equal(updated.title, 'Pine Ridge Dawn')
    assert.equal(updated.category, 'Field notes')

    // Download original
    const dlRes = await fetch(`${baseUrl}/api/videos/${uploadedClip.id}/original?download=1`, {
      headers: { Cookie: cookieA }
    })
    assert.equal(dlRes.status, 200)
    assert.match(dlRes.headers.get('content-disposition') || '', /attachment/)

    // User B cannot access User A's clip
    const bList = await (await fetch(`${baseUrl}/api/videos`, { headers: { Cookie: cookieB } })).json()
    assert.equal(bList.length, 0)

    const bGet = await fetch(`${baseUrl}/api/videos/${uploadedClip.id}`, { headers: { Cookie: cookieB } })
    assert.equal(bGet.status, 404)

    const bThumb = await fetch(`${baseUrl}/api/videos/${uploadedClip.id}/thumbnail`, { headers: { Cookie: cookieB } })
    assert.equal(bThumb.status, 403)

    const bPatch = await fetch(`${baseUrl}/api/videos/${uploadedClip.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: cookieB },
      body: JSON.stringify({ title: 'Stolen' })
    })
    assert.equal(bPatch.status, 404)
  })

  it('supports private share links, trash recovery, and permanent deletion cleanup', async () => {
    // Public share link works when active
    const shareRes = await fetch(`${baseUrl}/api/share/${uploadedClip.shareToken}`)
    assert.equal(shareRes.status, 200)
    const shared = await shareRes.json()
    assert.equal(shared.title, 'Pine Ridge Dawn')
    assert.ok(shared.playbackUrl)
    assert.ok(shared.thumbnailUrl)

    const sharedThumb = await fetch(`${baseUrl}${shared.thumbnailUrl}`)
    assert.equal(sharedThumb.status, 200)

    // Soft delete moves to trash and disables share link
    const delRes = await fetch(`${baseUrl}/api/videos/${uploadedClip.id}`, {
      method: 'DELETE',
      headers: { Cookie: cookieA }
    })
    assert.equal(delRes.status, 204)

    const shareWhileTrashed = await fetch(`${baseUrl}/api/share/${uploadedClip.shareToken}`)
    assert.equal(shareWhileTrashed.status, 404)

    const trashList = await (await fetch(`${baseUrl}/api/trash`, { headers: { Cookie: cookieA } })).json()
    assert.equal(trashList.length, 1)
    assert.equal(trashList[0].id, uploadedClip.id)

    // Restore brings it back
    const restoreRes = await fetch(`${baseUrl}/api/videos/${uploadedClip.id}/restore`, {
      method: 'POST',
      headers: { Cookie: cookieA }
    })
    assert.equal(restoreRes.status, 200)

    const activeList = await (await fetch(`${baseUrl}/api/videos`, { headers: { Cookie: cookieA } })).json()
    assert.equal(activeList.length, 1)

    // Soft delete again, then permanently delete and confirm disk cleanup
    await fetch(`${baseUrl}/api/videos/${uploadedClip.id}`, {
      method: 'DELETE',
      headers: { Cookie: cookieA }
    })

    const permRes = await fetch(`${baseUrl}/api/videos/${uploadedClip.id}/permanent`, {
      method: 'DELETE',
      headers: { Cookie: cookieA }
    })
    assert.equal(permRes.status, 204)

    const emptyTrash = await (await fetch(`${baseUrl}/api/trash`, { headers: { Cookie: cookieA } })).json()
    assert.equal(emptyTrash.length, 0)
    assert.equal(existsSync(join(dataDir, 'uploads', uploadedClip.file)), false)
    assert.equal(existsSync(join(dataDir, 'thumbs', `${uploadedClip.id}.jpg`)), false)
    assert.equal(existsSync(join(dataDir, 'hls', uploadedClip.id)), false)
  })
})
