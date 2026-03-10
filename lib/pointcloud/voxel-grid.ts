/**
 * Voxel grid downsampling for point clouds
 */

export interface VoxelGridOptions {
  leafSize: number  // voxel size in meters
}

/**
 * Downsample a point cloud using a voxel grid filter.
 * Input: Float32Array [x0,y0,z0, x1,y1,z1, ...]
 * Output: downsampled Float32Array
 */
export function voxelGridFilter(
  points: Float32Array,
  leafSize: number
): Float32Array {
  const numPoints = points.length / 3
  if (numPoints === 0) return new Float32Array(0)

  // Find bounds
  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity

  for (let i = 0; i < numPoints; i++) {
    const x = points[i * 3]
    const y = points[i * 3 + 1]
    const z = points[i * 3 + 2]
    if (x < minX) minX = x; if (x > maxX) maxX = x
    if (y < minY) minY = y; if (y > maxY) maxY = y
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z
  }

  const invLeaf = 1 / leafSize
  const voxels = new Map<string, { sx: number; sy: number; sz: number; count: number }>()

  for (let i = 0; i < numPoints; i++) {
    const x = points[i * 3]
    const y = points[i * 3 + 1]
    const z = points[i * 3 + 2]

    const vx = Math.floor((x - minX) * invLeaf)
    const vy = Math.floor((y - minY) * invLeaf)
    const vz = Math.floor((z - minZ) * invLeaf)
    const key = `${vx},${vy},${vz}`

    const existing = voxels.get(key)
    if (existing) {
      existing.sx += x
      existing.sy += y
      existing.sz += z
      existing.count++
    } else {
      voxels.set(key, { sx: x, sy: y, sz: z, count: 1 })
    }
  }

  const result = new Float32Array(voxels.size * 3)
  let i = 0
  for (const v of voxels.values()) {
    result[i++] = v.sx / v.count
    result[i++] = v.sy / v.count
    result[i++] = v.sz / v.count
  }

  return result
}

/**
 * Compute bounding box of a point cloud
 */
export function computeBoundingBox(points: Float32Array): {
  min: [number, number, number]
  max: [number, number, number]
  size: [number, number, number]
  center: [number, number, number]
} {
  const n = points.length / 3
  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity

  for (let i = 0; i < n; i++) {
    const x = points[i * 3], y = points[i * 3 + 1], z = points[i * 3 + 2]
    if (x < minX) minX = x; if (x > maxX) maxX = x
    if (y < minY) minY = y; if (y > maxY) maxY = y
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z
  }

  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
    size: [maxX - minX, maxY - minY, maxZ - minZ],
    center: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2],
  }
}

/**
 * Center and normalize point cloud around origin
 */
export function normalizePointCloud(points: Float32Array): Float32Array {
  const bbox = computeBoundingBox(points)
  const [cx, cy, cz] = bbox.center
  const maxSize = Math.max(...bbox.size)
  const scale = maxSize > 0 ? 1 / maxSize : 1

  const result = new Float32Array(points.length)
  for (let i = 0; i < points.length / 3; i++) {
    result[i * 3] = (points[i * 3] - cx) * scale
    result[i * 3 + 1] = (points[i * 3 + 1] - cy) * scale
    result[i * 3 + 2] = (points[i * 3 + 2] - cz) * scale
  }
  return result
}

/**
 * Estimate surface normals using PCA on local neighborhoods
 * Returns Float32Array [nx0,ny0,nz0, nx1,ny1,nz1, ...]
 */
export function estimateNormals(
  points: Float32Array,
  kNeighbors: number = 15
): Float32Array {
  const n = points.length / 3
  const normals = new Float32Array(n * 3)

  // For performance, use a simple grid-based neighborhood search
  const bbox = computeBoundingBox(points)
  const gridSize = Math.max(...bbox.size) / Math.cbrt(n) * 3
  const grid = buildSpatialGrid(points, gridSize)

  for (let i = 0; i < n; i++) {
    const px = points[i * 3], py = points[i * 3 + 1], pz = points[i * 3 + 2]
    const neighbors = getNeighbors(points, grid, px, py, pz, gridSize, kNeighbors)

    if (neighbors.length < 3) {
      normals[i * 3] = 0; normals[i * 3 + 1] = 1; normals[i * 3 + 2] = 0
      continue
    }

    // PCA on covariance matrix
    const [nx, ny, nz] = computeNormalPCA(points, neighbors)
    normals[i * 3] = nx
    normals[i * 3 + 1] = ny
    normals[i * 3 + 2] = nz
  }

  return normals
}

type SpatialGrid = Map<string, number[]>

function buildSpatialGrid(points: Float32Array, cellSize: number): SpatialGrid {
  const grid: SpatialGrid = new Map()
  const n = points.length / 3
  const inv = 1 / cellSize

  for (let i = 0; i < n; i++) {
    const cx = Math.floor(points[i * 3] * inv)
    const cy = Math.floor(points[i * 3 + 1] * inv)
    const cz = Math.floor(points[i * 3 + 2] * inv)
    const key = `${cx},${cy},${cz}`
    const cell = grid.get(key)
    if (cell) cell.push(i)
    else grid.set(key, [i])
  }

  return grid
}

function getNeighbors(
  points: Float32Array,
  grid: SpatialGrid,
  px: number, py: number, pz: number,
  cellSize: number,
  k: number
): number[] {
  const inv = 1 / cellSize
  const cx = Math.floor(px * inv)
  const cy = Math.floor(py * inv)
  const cz = Math.floor(pz * inv)

  const candidates: Array<{ idx: number; dist2: number }> = []

  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        const cell = grid.get(`${cx + dx},${cy + dy},${cz + dz}`)
        if (!cell) continue
        for (const idx of cell) {
          const qx = points[idx * 3], qy = points[idx * 3 + 1], qz = points[idx * 3 + 2]
          const d2 = (qx - px) ** 2 + (qy - py) ** 2 + (qz - pz) ** 2
          candidates.push({ idx, dist2: d2 })
        }
      }
    }
  }

  candidates.sort((a, b) => a.dist2 - b.dist2)
  return candidates.slice(1, k + 1).map(c => c.idx)
}

function computeNormalPCA(points: Float32Array, neighborIndices: number[]): [number, number, number] {
  const n = neighborIndices.length
  let mx = 0, my = 0, mz = 0

  for (const idx of neighborIndices) {
    mx += points[idx * 3]
    my += points[idx * 3 + 1]
    mz += points[idx * 3 + 2]
  }
  mx /= n; my /= n; mz /= n

  // 3×3 covariance matrix
  let cxx = 0, cxy = 0, cxz = 0, cyy = 0, cyz = 0, czz = 0
  for (const idx of neighborIndices) {
    const dx = points[idx * 3] - mx
    const dy = points[idx * 3 + 1] - my
    const dz = points[idx * 3 + 2] - mz
    cxx += dx * dx; cxy += dx * dy; cxz += dx * dz
    cyy += dy * dy; cyz += dy * dz; czz += dz * dz
  }

  // Smallest eigenvector via power iteration on inverse (simplified)
  // Use a quick approximation: cross product of two principal directions
  const [e1x, e1y, e1z] = powerIterate([[cxx, cxy, cxz], [cxy, cyy, cyz], [cxz, cyz, czz]])

  // Normalize
  const len = Math.sqrt(e1x * e1x + e1y * e1y + e1z * e1z)
  return len > 0 ? [e1x / len, e1y / len, e1z / len] : [0, 1, 0]
}

function powerIterate(m: number[][]): [number, number, number] {
  let vx = 0.1, vy = 0.9, vz = 0.1
  for (let iter = 0; iter < 10; iter++) {
    const nx = m[0][0] * vx + m[0][1] * vy + m[0][2] * vz
    const ny = m[1][0] * vx + m[1][1] * vy + m[1][2] * vz
    const nz = m[2][0] * vx + m[2][1] * vy + m[2][2] * vz
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz)
    if (len < 1e-10) break
    vx = nx / len; vy = ny / len; vz = nz / len
  }
  return [vx, vy, vz]
}
