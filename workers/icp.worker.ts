/**
 * Web Worker for ICP (Iterative Closest Point) point cloud registration
 * Used to align successive frames with higher accuracy
 */

type WorkerMessage =
  | { type: 'align'; source: ArrayBuffer; target: ArrayBuffer; maxIterations: number }
  | { type: 'ping' }

type WorkerResponse =
  | { type: 'aligned'; transform: number[]; rmse: number }
  | { type: 'pong' }
  | { type: 'error'; message: string }

self.onmessage = (event: MessageEvent<WorkerMessage>) => {
  const msg = event.data

  if (msg.type === 'ping') {
    self.postMessage({ type: 'pong' } as WorkerResponse)
    return
  }

  if (msg.type === 'align') {
    try {
      const source = new Float32Array(msg.source)
      const target = new Float32Array(msg.target)

      const result = icpAlign(source, target, msg.maxIterations)
      const response: WorkerResponse = {
        type: 'aligned',
        transform: Array.from(result.transform),
        rmse: result.rmse,
      }
      self.postMessage(response)
    } catch (e) {
      const response: WorkerResponse = {
        type: 'error',
        message: e instanceof Error ? e.message : String(e),
      }
      self.postMessage(response)
    }
  }
}

/**
 * Simplified ICP implementation
 * Returns a 4×4 transformation matrix (column-major) and RMSE
 */
function icpAlign(
  source: Float32Array,
  target: Float32Array,
  maxIterations: number = 20
): { transform: Float32Array; rmse: number } {
  const numSource = source.length / 3

  // Initialize transform as identity
  let tx = 0, ty = 0, tz = 0  // translation
  let rmse = Infinity

  for (let iter = 0; iter < maxIterations; iter++) {
    // 1. Find correspondences: nearest neighbor in target for each source point
    let sumX = 0, sumY = 0, sumZ = 0
    let tSumX = 0, tSumY = 0, tSumZ = 0
    let count = 0

    for (let i = 0; i < numSource; i++) {
      const sx = source[i * 3] + tx
      const sy = source[i * 3 + 1] + ty
      const sz = source[i * 3 + 2] + tz

      const nearest = findNearest(target, sx, sy, sz)
      if (nearest === null) continue

      sumX += sx; sumY += sy; sumZ += sz
      tSumX += nearest[0]; tSumY += nearest[1]; tSumZ += nearest[2]
      count++
    }

    if (count === 0) break

    // 2. Compute centroids
    const sCx = sumX / count, sCy = sumY / count, sCz = sumZ / count
    const tCx = tSumX / count, tCy = tSumY / count, tCz = tSumZ / count

    // 3. Update translation (simplified - no rotation for stability)
    const dTx = tCx - sCx
    const dTy = tCy - sCy
    const dTz = tCz - sCz

    tx += dTx * 0.5
    ty += dTy * 0.5
    tz += dTz * 0.5

    // 4. Compute RMSE
    rmse = Math.sqrt((dTx * dTx + dTy * dTy + dTz * dTz))
    if (rmse < 0.001) break  // Converged
  }

  // Build 4×4 column-major transform matrix
  const transform = new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    tx, ty, tz, 1,
  ])

  return { transform, rmse }
}

function findNearest(
  target: Float32Array,
  x: number, y: number, z: number
): [number, number, number] | null {
  const numTarget = target.length / 3
  if (numTarget === 0) return null

  let minDist2 = Infinity
  let bestIdx = 0

  // Sample every 4th point for performance
  for (let i = 0; i < numTarget; i += 4) {
    const tx = target[i * 3], ty = target[i * 3 + 1], tz = target[i * 3 + 2]
    const d2 = (x - tx) ** 2 + (y - ty) ** 2 + (z - tz) ** 2
    if (d2 < minDist2) {
      minDist2 = d2
      bestIdx = i
    }
  }

  return [target[bestIdx * 3], target[bestIdx * 3 + 1], target[bestIdx * 3 + 2]]
}

export {}
