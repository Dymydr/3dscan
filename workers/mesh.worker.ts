/**
 * Web Worker for heavy mesh processing tasks
 * Runs Poisson reconstruction and mesh cleanup off the main thread
 */

import { voxelGridFilter, estimateNormals } from '../lib/pointcloud/voxel-grid'
import { reconstructMesh, computeMeshMetrics } from '../lib/meshing/poisson'

type WorkerMessage =
  | { type: 'reconstruct'; points: ArrayBuffer; voxelSize: number; gridResolution: number }
  | { type: 'ping' }

type WorkerResponse =
  | { type: 'progress'; percent: number; message: string }
  | { type: 'complete'; vertices: ArrayBuffer; indices: ArrayBuffer; normals: ArrayBuffer; vertexCount: number; triangleCount: number; surfaceArea: number; volume: number }
  | { type: 'error'; message: string }
  | { type: 'pong' }

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const msg = event.data

  if (msg.type === 'ping') {
    const response: WorkerResponse = { type: 'pong' }
    self.postMessage(response)
    return
  }

  if (msg.type === 'reconstruct') {
    try {
      const rawPoints = new Float32Array(msg.points)

      const report = (percent: number, message: string) => {
        const response: WorkerResponse = { type: 'progress', percent, message }
        self.postMessage(response)
      }

      report(5, 'Downsampling point cloud...')
      const downsampled = voxelGridFilter(rawPoints, msg.voxelSize)

      if (downsampled.length < 30) {
        throw new Error('Not enough points after downsampling. Try scanning more of the object.')
      }

      report(20, 'Estimating surface normals...')
      const normals = estimateNormals(downsampled, 15)

      report(35, 'Running surface reconstruction...')
      const mesh = await reconstructMesh(downsampled, normals, {
        gridResolution: msg.gridResolution,
        smoothingPasses: 2,
        onProgress: (pct, msg2) => report(35 + pct * 0.6, msg2),
      })

      report(96, 'Computing metrics...')
      const metrics = computeMeshMetrics(mesh)

      report(100, 'Complete!')

      const vBuf = mesh.vertices.buffer as ArrayBuffer
      const iBuf = mesh.indices.buffer as ArrayBuffer
      const nBuf = mesh.normals.buffer as ArrayBuffer

      const response: WorkerResponse = {
        type: 'complete',
        vertices: vBuf,
        indices: iBuf,
        normals: nBuf,
        vertexCount: mesh.vertexCount,
        triangleCount: mesh.triangleCount,
        surfaceArea: metrics.surfaceArea,
        volume: metrics.volume,
      }

      ;(self as unknown as DedicatedWorkerGlobalScope).postMessage(response, [vBuf, iBuf, nBuf])
    } catch (e) {
      const response: WorkerResponse = {
        type: 'error',
        message: e instanceof Error ? e.message : String(e),
      }
      self.postMessage(response)
    }
  }
}

export {}
