/**
 * IndexedDB storage for scan sessions
 * Uses the 'idb' library for a promise-based API
 */

import { openDB, type IDBPDatabase } from 'idb'
import type { MeshData } from '../meshing/poisson'

const DB_NAME = 'lidar-scanner-db'
const DB_VERSION = 1
const SCANS_STORE = 'scans'
const POINTCLOUDS_STORE = 'pointclouds'

export interface ScanRecord {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  pointCount: number
  thumbnailDataURL?: string  // base64 PNG thumbnail
  dimensions?: {
    width: number
    height: number
    depth: number
  }
  hasMesh: boolean
  tags?: string[]
}

let db: IDBPDatabase | null = null

async function getDB(): Promise<IDBPDatabase> {
  if (db) return db

  db = await openDB(DB_NAME, DB_VERSION, {
    upgrade(database) {
      if (!database.objectStoreNames.contains(SCANS_STORE)) {
        const store = database.createObjectStore(SCANS_STORE, { keyPath: 'id' })
        store.createIndex('createdAt', 'createdAt')
      }
      if (!database.objectStoreNames.contains(POINTCLOUDS_STORE)) {
        database.createObjectStore(POINTCLOUDS_STORE, { keyPath: 'id' })
      }
    },
  })

  return db
}

/**
 * Save or update a scan record
 */
export async function saveScanRecord(record: ScanRecord): Promise<void> {
  const database = await getDB()
  await database.put(SCANS_STORE, { ...record, updatedAt: Date.now() })
}

/**
 * Save point cloud data for a scan
 */
export async function savePointCloud(
  scanId: string,
  pointCloud: Float32Array
): Promise<void> {
  const database = await getDB()
  await database.put(POINTCLOUDS_STORE, {
    id: scanId,
    data: pointCloud.buffer,
    count: pointCloud.length / 3,
  })
}

/**
 * Save mesh data for a scan
 */
export async function saveMesh(scanId: string, mesh: MeshData): Promise<void> {
  const database = await getDB()
  await database.put(POINTCLOUDS_STORE, {
    id: `${scanId}-mesh`,
    vertices: mesh.vertices.buffer,
    indices: mesh.indices.buffer,
    normals: mesh.normals.buffer,
    vertexCount: mesh.vertexCount,
    triangleCount: mesh.triangleCount,
  })
}

/**
 * Load point cloud for a scan
 */
export async function loadPointCloud(scanId: string): Promise<Float32Array | null> {
  const database = await getDB()
  const record = await database.get(POINTCLOUDS_STORE, scanId)
  if (!record) return null
  return new Float32Array(record.data)
}

/**
 * Load mesh for a scan
 */
export async function loadMesh(scanId: string): Promise<MeshData | null> {
  const database = await getDB()
  const record = await database.get(POINTCLOUDS_STORE, `${scanId}-mesh`)
  if (!record) return null

  return {
    vertices: new Float32Array(record.vertices),
    indices: new Uint32Array(record.indices),
    normals: new Float32Array(record.normals),
    vertexCount: record.vertexCount,
    triangleCount: record.triangleCount,
  }
}

/**
 * List all scan records, sorted by creation date (newest first)
 */
export async function listScans(): Promise<ScanRecord[]> {
  const database = await getDB()
  const all = await database.getAll(SCANS_STORE)
  return all.sort((a, b) => b.createdAt - a.createdAt)
}

/**
 * Get a single scan record
 */
export async function getScanRecord(id: string): Promise<ScanRecord | null> {
  const database = await getDB()
  return database.get(SCANS_STORE, id) ?? null
}

/**
 * Delete a scan and its associated data
 */
export async function deleteScan(id: string): Promise<void> {
  const database = await getDB()
  const tx = database.transaction([SCANS_STORE, POINTCLOUDS_STORE], 'readwrite')
  await Promise.all([
    tx.objectStore(SCANS_STORE).delete(id),
    tx.objectStore(POINTCLOUDS_STORE).delete(id),
    tx.objectStore(POINTCLOUDS_STORE).delete(`${id}-mesh`),
    tx.done,
  ])
}

/**
 * Generate a unique scan ID
 */
export function generateScanId(): string {
  return `scan-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

/**
 * Estimate total storage used (bytes)
 */
export async function estimateStorageUsage(): Promise<number> {
  if ('storage' in navigator && 'estimate' in navigator.storage) {
    const estimate = await navigator.storage.estimate()
    return estimate.usage ?? 0
  }
  return 0
}
