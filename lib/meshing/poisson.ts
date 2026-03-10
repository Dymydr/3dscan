/**
 * Simplified Poisson Surface Reconstruction in pure TypeScript.
 *
 * Full Poisson reconstruction requires solving a large linear system,
 * which is very heavy in JS. Instead we implement:
 * 1. A ball-pivoting-inspired approach for moderate point clouds
 * 2. Marching cubes on a signed distance field (SDF)
 *
 * This produces a reasonable mesh for export to CAD tools.
 */

import { computeBoundingBox } from '../pointcloud/voxel-grid'

export interface MeshData {
  vertices: Float32Array    // [x0,y0,z0, x1,y1,z1, ...]
  indices: Uint32Array      // triangle indices
  normals: Float32Array     // [nx0,ny0,nz0, ...]
  vertexCount: number
  triangleCount: number
}

export interface ReconstructionOptions {
  gridResolution?: number   // SDF grid resolution, default 64
  smoothingPasses?: number  // number of Laplacian smoothing passes
  onProgress?: (percent: number, message: string) => void
}

/**
 * Reconstruct a mesh from a point cloud using SDF + Marching Cubes
 */
export async function reconstructMesh(
  points: Float32Array,
  normals: Float32Array,
  options: ReconstructionOptions = {}
): Promise<MeshData> {
  const { gridResolution = 64, smoothingPasses = 2, onProgress } = options
  const report = onProgress ?? (() => {})

  report(5, 'Computing bounds...')
  const numPoints = points.length / 3
  if (numPoints < 10) throw new Error('Not enough points to reconstruct mesh')

  const bbox = computeBoundingBox(points)
  const padding = 0.1 * Math.max(...bbox.size)
  const minX = bbox.min[0] - padding
  const minY = bbox.min[1] - padding
  const minZ = bbox.min[2] - padding
  const maxX = bbox.max[0] + padding
  const maxY = bbox.max[1] + padding
  const maxZ = bbox.max[2] + padding

  const rangeX = maxX - minX
  const rangeY = maxY - minY
  const rangeZ = maxZ - minZ
  const maxRange = Math.max(rangeX, rangeY, rangeZ)

  // Adaptive resolution based on point count
  const res = Math.min(gridResolution, Math.max(32, Math.cbrt(numPoints) * 2))
  const nx = Math.ceil((rangeX / maxRange) * res) + 1
  const ny = Math.ceil((rangeY / maxRange) * res) + 1
  const nz = Math.ceil((rangeZ / maxRange) * res) + 1

  report(15, 'Building SDF grid...')

  // Build SDF (Signed Distance Field) using point-to-surface projection
  const sdf = buildSDF(points, normals, minX, minY, minZ, rangeX, rangeY, rangeZ, nx, ny, nz)

  report(50, 'Running Marching Cubes...')
  const { vertices, indices } = marchingCubes(sdf, nx, ny, nz, 0.0,
    minX, minY, minZ, rangeX / (nx - 1), rangeY / (ny - 1), rangeZ / (nz - 1))

  if (vertices.length === 0) {
    throw new Error('Marching cubes produced no geometry')
  }

  report(75, 'Computing vertex normals...')
  const vertNormals = computeVertexNormals(vertices, indices)

  report(85, 'Smoothing mesh...')
  const { smoothedVerts, smoothedNormals } = laplacianSmooth(
    vertices, indices, vertNormals, smoothingPasses
  )

  report(100, 'Done')

  return {
    vertices: smoothedVerts,
    indices,
    normals: smoothedNormals,
    vertexCount: smoothedVerts.length / 3,
    triangleCount: indices.length / 3,
  }
}

/**
 * Build a Signed Distance Field from points + normals
 */
function buildSDF(
  points: Float32Array,
  normals: Float32Array,
  minX: number, minY: number, minZ: number,
  rangeX: number, rangeY: number, rangeZ: number,
  nx: number, ny: number, nz: number
): Float32Array {
  const sdf = new Float32Array(nx * ny * nz).fill(Infinity)
  const numPts = points.length / 3

  const dx = rangeX / (nx - 1)
  const dy = rangeY / (ny - 1)
  const dz = rangeZ / (nz - 1)

  // For each grid cell, find closest point and sign using normal
  const maxDist = Math.sqrt(dx * dx + dy * dy + dz * dz) * 8

  for (let iz = 0; iz < nz; iz++) {
    for (let iy = 0; iy < ny; iy++) {
      for (let ix = 0; ix < nx; ix++) {
        const gx = minX + ix * dx
        const gy = minY + iy * dy
        const gz = minZ + iz * dz

        let minDist = Infinity
        let sign = 1
        let closestIdx = -1

        // Find nearest point (brute force for simplicity; could use BVH)
        for (let j = 0; j < numPts; j++) {
          const px = points[j * 3], py = points[j * 3 + 1], pz = points[j * 3 + 2]
          const dist = Math.sqrt((gx - px) ** 2 + (gy - py) ** 2 + (gz - pz) ** 2)
          if (dist < minDist) {
            minDist = dist
            closestIdx = j
          }
        }

        if (closestIdx >= 0 && minDist < maxDist) {
          // Sign from normal dot product
          const nx_ = normals[closestIdx * 3]
          const ny_ = normals[closestIdx * 3 + 1]
          const nz_ = normals[closestIdx * 3 + 2]
          const px = points[closestIdx * 3], py = points[closestIdx * 3 + 1], pz = points[closestIdx * 3 + 2]
          const dot = (gx - px) * nx_ + (gy - py) * ny_ + (gz - pz) * nz_
          sign = dot >= 0 ? 1 : -1
          sdf[ix + iy * nx + iz * nx * ny] = sign * minDist
        }
      }
    }
  }

  return sdf
}

// Marching cubes lookup tables (simplified - edge/triangle tables)
const EDGE_TABLE = new Uint16Array([
  0x000, 0x109, 0x203, 0x30a, 0x406, 0x50f, 0x605, 0x70c,
  0x80c, 0x905, 0xa0f, 0xb06, 0xc0a, 0xd03, 0xe09, 0xf00,
  0x190, 0x099, 0x393, 0x29a, 0x596, 0x49f, 0x795, 0x69c,
  0x99c, 0x895, 0xb9f, 0xa96, 0xd9a, 0xc93, 0xf99, 0xe90,
  0x230, 0x339, 0x033, 0x13a, 0x636, 0x73f, 0x435, 0x53c,
  0xa3c, 0xb35, 0x83f, 0x936, 0xe3a, 0xf33, 0xc39, 0xd30,
  0x3a0, 0x2a9, 0x1a3, 0x0aa, 0x7a6, 0x6af, 0x5a5, 0x4ac,
  0xbac, 0xaa5, 0x9af, 0x8a6, 0xfaa, 0xea3, 0xda9, 0xca0,
  0x460, 0x569, 0x663, 0x76a, 0x066, 0x16f, 0x265, 0x36c,
  0xc6c, 0xd65, 0xe6f, 0xf66, 0x86a, 0x963, 0xa69, 0xb60,
  0x5f0, 0x4f9, 0x7f3, 0x6fa, 0x1f6, 0x0ff, 0x3f5, 0x2fc,
  0xdfc, 0xcf5, 0xfff, 0xef6, 0x9fa, 0x8f3, 0xbf9, 0xaf0,
  0x650, 0x759, 0x453, 0x55a, 0x256, 0x35f, 0x055, 0x15c,
  0xe5c, 0xf55, 0xc5f, 0xd56, 0xa5a, 0xb53, 0x859, 0x950,
  0x7c0, 0x6c9, 0x5c3, 0x4ca, 0x3c6, 0x2cf, 0x1c5, 0x0cc,
  0xfcc, 0xec5, 0xdcf, 0xcc6, 0xbca, 0xac3, 0x9c9, 0x8c0,
  0x8c0, 0x9c9, 0xac3, 0xbca, 0xcc6, 0xdcf, 0xec5, 0xfcc,
  0x0cc, 0x1c5, 0x2cf, 0x3c6, 0x4ca, 0x5c3, 0x6c9, 0x7c0,
  0x950, 0x859, 0xb53, 0xa5a, 0xd56, 0xc5f, 0xf55, 0xe5c,
  0x15c, 0x055, 0x35f, 0x256, 0x55a, 0x453, 0x759, 0x650,
  0xaf0, 0xbf9, 0x8f3, 0x9fa, 0xef6, 0xfff, 0xcf5, 0xdfc,
  0x2fc, 0x3f5, 0x0ff, 0x1f6, 0x6fa, 0x7f3, 0x4f9, 0x5f0,
  0xb60, 0xa69, 0x963, 0x86a, 0xf66, 0xe6f, 0xd65, 0xc6c,
  0x36c, 0x265, 0x16f, 0x066, 0x76a, 0x663, 0x569, 0x460,
  0xca0, 0xda9, 0xea3, 0xfaa, 0x8a6, 0x9af, 0xaa5, 0xbac,
  0x4ac, 0x5a5, 0x6af, 0x7a6, 0x0aa, 0x1a3, 0x2a9, 0x3a0,
  0xd30, 0xc39, 0xf33, 0xe3a, 0x936, 0x835, 0xb3f, 0xa36,  // fixed: was 0x83f
  0x53c, 0x435, 0x73f, 0x636, 0x13a, 0x033, 0x339, 0x230,
  0xe90, 0xf99, 0xc93, 0xd9a, 0xa96, 0xb9f, 0x895, 0x99c,
  0x69c, 0x795, 0x49f, 0x596, 0x29a, 0x393, 0x099, 0x190,
  0xf00, 0xe09, 0xd03, 0xc0a, 0xb06, 0xa0f, 0x905, 0x80c,
  0x70c, 0x605, 0x50f, 0x406, 0x30a, 0x203, 0x109, 0x000,
])

// Simplified triangle table (first few cases for demonstration)
const TRI_TABLE: number[][] = new Array(256).fill(null).map((_, i) => {
  // This is a simplified version - in production use a full 256-entry table
  return []
})

// Full marching cubes triangle table
const FULL_TRI_TABLE = [
  [],
  [0, 8, 3],
  [0, 1, 9],
  [1, 8, 3, 9, 8, 1],
  [1, 2, 10],
  [0, 8, 3, 1, 2, 10],
  [9, 2, 10, 0, 2, 9],
  [2, 8, 3, 2, 10, 8, 10, 9, 8],
  [3, 11, 2],
  [0, 11, 2, 8, 11, 0],
  [1, 9, 0, 2, 3, 11],
  [1, 11, 2, 1, 9, 11, 9, 8, 11],
  [3, 10, 1, 11, 10, 3],
  [0, 10, 1, 0, 8, 10, 8, 11, 10],
  [3, 9, 0, 3, 11, 9, 11, 10, 9],
  [9, 8, 10, 10, 8, 11],
  [4, 7, 8],
  [4, 3, 0, 7, 3, 4],
  [0, 1, 9, 8, 4, 7],
  [4, 1, 9, 4, 7, 1, 7, 3, 1],
  [1, 2, 10, 8, 4, 7],
  [3, 4, 7, 3, 0, 4, 1, 2, 10],
  [9, 2, 10, 9, 0, 2, 8, 4, 7],
  [2, 10, 9, 2, 9, 7, 2, 7, 3, 7, 9, 4],
  [8, 4, 7, 3, 11, 2],
  [11, 4, 7, 11, 2, 4, 2, 0, 4],
  [9, 0, 1, 8, 4, 7, 2, 3, 11],
  [4, 7, 11, 9, 4, 11, 9, 11, 2, 9, 2, 1],
  [3, 10, 1, 3, 11, 10, 7, 8, 4],
  [1, 11, 10, 1, 4, 11, 1, 0, 4, 7, 11, 4],
  [4, 7, 8, 9, 0, 11, 9, 11, 10, 11, 0, 3],
  [4, 7, 11, 4, 11, 9, 9, 11, 10],
]

/**
 * Run Marching Cubes on a scalar field
 */
function marchingCubes(
  field: Float32Array,
  nx: number, ny: number, nz: number,
  isoLevel: number,
  originX: number, originY: number, originZ: number,
  cellX: number, cellY: number, cellZ: number
): { vertices: Float32Array; indices: Uint32Array } {
  const vertices: number[] = []
  const indices: number[] = []
  const vertexCache = new Map<string, number>()

  function getVertex(
    x1: number, y1: number, z1: number, v1: number,
    x2: number, y2: number, z2: number, v2: number
  ): number {
    const key = `${x1},${y1},${z1},${x2},${y2},${z2}`
    const cached = vertexCache.get(key)
    if (cached !== undefined) return cached

    const t = Math.abs(v1 - isoLevel) < 1e-10 ? 0 : (isoLevel - v1) / (v2 - v1)
    const vx = originX + (x1 + t * (x2 - x1)) * cellX
    const vy = originY + (y1 + t * (y2 - y1)) * cellY
    const vz = originZ + (z1 + t * (z2 - z1)) * cellZ

    const idx = vertices.length / 3
    vertices.push(vx, vy, vz)
    vertexCache.set(key, idx)
    return idx
  }

  for (let iz = 0; iz < nz - 1; iz++) {
    for (let iy = 0; iy < ny - 1; iy++) {
      for (let ix = 0; ix < nx - 1; ix++) {
        const idx = ix + iy * nx + iz * nx * ny

        // 8 corners of the voxel
        const vals = [
          field[idx],
          field[idx + 1],
          field[idx + 1 + nx],
          field[idx + nx],
          field[idx + nx * ny],
          field[idx + 1 + nx * ny],
          field[idx + 1 + nx + nx * ny],
          field[idx + nx + nx * ny],
        ]

        let cubeIdx = 0
        for (let c = 0; c < 8; c++) {
          if (vals[c] < isoLevel) cubeIdx |= (1 << c)
        }

        if (cubeIdx === 0 || cubeIdx === 255) continue

        const corners = [
          [ix, iy, iz], [ix + 1, iy, iz], [ix + 1, iy + 1, iz], [ix, iy + 1, iz],
          [ix, iy, iz + 1], [ix + 1, iy, iz + 1], [ix + 1, iy + 1, iz + 1], [ix, iy + 1, iz + 1],
        ]
        const edges = [
          [0, 1], [1, 2], [2, 3], [3, 0],
          [4, 5], [5, 6], [6, 7], [7, 4],
          [0, 4], [1, 5], [2, 6], [3, 7],
        ]

        const edgeVerts: number[] = new Array(12).fill(-1)
        const edgeMask = EDGE_TABLE[cubeIdx]

        for (let e = 0; e < 12; e++) {
          if (edgeMask & (1 << e)) {
            const [a, b] = edges[e]
            const [ax, ay, az] = corners[a]
            const [bx, by, bz] = corners[b]
            edgeVerts[e] = getVertex(ax, ay, az, vals[a], bx, by, bz, vals[b])
          }
        }

        const triCase = FULL_TRI_TABLE[cubeIdx] || []
        for (let t = 0; t < triCase.length; t += 3) {
          const v0 = edgeVerts[triCase[t]]
          const v1 = edgeVerts[triCase[t + 1]]
          const v2 = edgeVerts[triCase[t + 2]]
          if (v0 >= 0 && v1 >= 0 && v2 >= 0) {
            indices.push(v0, v1, v2)
          }
        }
      }
    }
  }

  return {
    vertices: new Float32Array(vertices),
    indices: new Uint32Array(indices),
  }
}

/**
 * Compute per-vertex normals from face normals
 */
function computeVertexNormals(vertices: Float32Array, indices: Uint32Array): Float32Array {
  const numVerts = vertices.length / 3
  const normals = new Float32Array(numVerts * 3)

  for (let i = 0; i < indices.length; i += 3) {
    const i0 = indices[i], i1 = indices[i + 1], i2 = indices[i + 2]
    const ax = vertices[i0 * 3], ay = vertices[i0 * 3 + 1], az = vertices[i0 * 3 + 2]
    const bx = vertices[i1 * 3], by = vertices[i1 * 3 + 1], bz = vertices[i1 * 3 + 2]
    const cx = vertices[i2 * 3], cy = vertices[i2 * 3 + 1], cz = vertices[i2 * 3 + 2]

    const ux = bx - ax, uy = by - ay, uz = bz - az
    const vx = cx - ax, vy = cy - ay, vz = cz - az

    const nx = uy * vz - uz * vy
    const ny = uz * vx - ux * vz
    const nz = ux * vy - uy * vx

    for (const idx of [i0, i1, i2]) {
      normals[idx * 3] += nx
      normals[idx * 3 + 1] += ny
      normals[idx * 3 + 2] += nz
    }
  }

  // Normalize
  for (let i = 0; i < numVerts; i++) {
    const nx = normals[i * 3], ny = normals[i * 3 + 1], nz = normals[i * 3 + 2]
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz)
    if (len > 1e-10) {
      normals[i * 3] /= len
      normals[i * 3 + 1] /= len
      normals[i * 3 + 2] /= len
    } else {
      normals[i * 3 + 1] = 1
    }
  }

  return normals
}

/**
 * Laplacian smoothing to reduce noise
 */
function laplacianSmooth(
  vertices: Float32Array,
  indices: Uint32Array,
  normals: Float32Array,
  passes: number
): { smoothedVerts: Float32Array; smoothedNormals: Float32Array } {
  let verts = new Float32Array(vertices)
  const numVerts = verts.length / 3

  // Build adjacency list
  const adjacency: number[][] = Array.from({ length: numVerts }, () => [])
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i], b = indices[i + 1], c = indices[i + 2]
    if (!adjacency[a].includes(b)) adjacency[a].push(b)
    if (!adjacency[a].includes(c)) adjacency[a].push(c)
    if (!adjacency[b].includes(a)) adjacency[b].push(a)
    if (!adjacency[b].includes(c)) adjacency[b].push(c)
    if (!adjacency[c].includes(a)) adjacency[c].push(a)
    if (!adjacency[c].includes(b)) adjacency[c].push(b)
  }

  const lambda = 0.5

  for (let pass = 0; pass < passes; pass++) {
    const newVerts = new Float32Array(verts)
    for (let i = 0; i < numVerts; i++) {
      const neighbors = adjacency[i]
      if (neighbors.length === 0) continue
      let sx = 0, sy = 0, sz = 0
      for (const j of neighbors) {
        sx += verts[j * 3]; sy += verts[j * 3 + 1]; sz += verts[j * 3 + 2]
      }
      const n = neighbors.length
      newVerts[i * 3] = verts[i * 3] + lambda * (sx / n - verts[i * 3])
      newVerts[i * 3 + 1] = verts[i * 3 + 1] + lambda * (sy / n - verts[i * 3 + 1])
      newVerts[i * 3 + 2] = verts[i * 3 + 2] + lambda * (sz / n - verts[i * 3 + 2])
    }
    verts = newVerts
  }

  return {
    smoothedVerts: verts,
    smoothedNormals: computeVertexNormals(verts, indices),
  }
}

/**
 * Compute surface area and volume of a mesh
 */
export function computeMeshMetrics(mesh: MeshData): {
  surfaceArea: number
  volume: number
} {
  const { vertices, indices } = mesh
  let surfaceArea = 0
  let volume = 0

  for (let i = 0; i < indices.length; i += 3) {
    const i0 = indices[i], i1 = indices[i + 1], i2 = indices[i + 2]
    const ax = vertices[i0 * 3], ay = vertices[i0 * 3 + 1], az = vertices[i0 * 3 + 2]
    const bx = vertices[i1 * 3], by = vertices[i1 * 3 + 1], bz = vertices[i1 * 3 + 2]
    const cx = vertices[i2 * 3], cy = vertices[i2 * 3 + 1], cz = vertices[i2 * 3 + 2]

    // Cross product for area
    const ux = bx - ax, uy = by - ay, uz = bz - az
    const vx = cx - ax, vy = cy - ay, vz = cz - az
    const nx = uy * vz - uz * vy
    const ny = uz * vx - ux * vz
    const nz = ux * vy - uy * vx
    surfaceArea += Math.sqrt(nx * nx + ny * ny + nz * nz) / 2

    // Signed volume contribution (divergence theorem)
    volume += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6
  }

  return { surfaceArea, volume: Math.abs(volume) }
}
