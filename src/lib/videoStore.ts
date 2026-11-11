// Guarda el último video y su análisis en IndexedDB, dentro de este navegador,
// para que no se pierdan al recargar la página. Nada sale del dispositivo.

const DB_NAME = 'kora'
const STORE = 'kv'

export interface StoredVideo {
  blob: Blob
  name: string
  /** Huella del archivo: nombre, tamaño y fecha */
  key: string
}

export interface StoredAnalysis {
  version: number
  videoKey: string
  analysis: unknown
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb()
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode)
      const req = fn(tx.objectStore(STORE))
      tx.oncomplete = () => resolve(req.result)
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

// Todas las operaciones fallan en silencio: sin IndexedDB (modo privado, cuota
// llena) la app sigue funcionando, solo que el video no sobrevive a la recarga.
const quiet = <T,>(p: Promise<T>): Promise<T | undefined> => p.catch(() => undefined)

export const putVideo = (v: StoredVideo) => quiet(run('readwrite', (s) => s.put(v, 'video')))
export const getVideo = () => quiet(run<StoredVideo | undefined>('readonly', (s) => s.get('video')))
export const putAnalysis = (a: StoredAnalysis) => quiet(run('readwrite', (s) => s.put(a, 'analysis')))
export const getAnalysis = () => quiet(run<StoredAnalysis | undefined>('readonly', (s) => s.get('analysis')))
export const clearAnalysis = () => quiet(run('readwrite', (s) => s.delete('analysis')))
export const clearStoredVideo = () => quiet(run('readwrite', (s) => s.clear()))
