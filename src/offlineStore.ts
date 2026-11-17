const DB_NAME = 'afterframe-offline'
const DB_VERSION = 1
const VIDEOS_STORE = 'videos'
const THUMBS_STORE = 'thumbs'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'))
      return
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(VIDEOS_STORE)) {
        db.createObjectStore(VIDEOS_STORE)
      }
      if (!db.objectStoreNames.contains(THUMBS_STORE)) {
        db.createObjectStore(THUMBS_STORE)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function putBlob(storeName: string, id: string, blob: Blob): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite')
    tx.objectStore(storeName).put(blob, id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

async function getBlob(storeName: string, id: string): Promise<Blob | null> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly')
    const req = tx.objectStore(storeName).get(id)
    req.onsuccess = () => resolve((req.result as Blob) || null)
    req.onerror = () => reject(req.error)
  })
}

async function deleteKey(storeName: string, id: string): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite')
    tx.objectStore(storeName).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

async function listKeys(storeName: string): Promise<string[]> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly')
    const req = tx.objectStore(storeName).getAllKeys()
    req.onsuccess = () => resolve((req.result as string[]).map(String))
    req.onerror = () => reject(req.error)
  })
}

export const saveOfflineVideo = (id: string, blob: Blob) => putBlob(VIDEOS_STORE, id, blob)
export const getOfflineVideo = (id: string) => getBlob(VIDEOS_STORE, id)
export const deleteOfflineVideo = async (id: string) => {
  await Promise.all([deleteKey(VIDEOS_STORE, id), deleteKey(THUMBS_STORE, id)])
}
export const listOfflineVideoIds = () => listKeys(VIDEOS_STORE)

export const saveOfflineThumb = (id: string, blob: Blob) => putBlob(THUMBS_STORE, id, blob)
export const getOfflineThumb = (id: string) => getBlob(THUMBS_STORE, id)

export async function clearAllOfflineData(): Promise<void> {
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([VIDEOS_STORE, THUMBS_STORE], 'readwrite')
      tx.objectStore(VIDEOS_STORE).clear()
      tx.objectStore(THUMBS_STORE).clear()
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch {
    // Ignore storage cleanup errors
  }
}
