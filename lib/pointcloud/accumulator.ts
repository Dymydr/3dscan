/**
 * Point cloud accumulator: merges depth frames into a single world-space point cloud
 * using voxel-grid downsampling to manage memory and reduce noise.
 */

import type { DepthFrame } from '../lidar/types'

export interface AccumulatorOptions {
  voxelSize?: number        // meters, default 0.005 (5mm)
  maxPoints?: number        // cap total points, default 500_000
  minDepth?: number         // meters
  maxDepth?: number         // meters
}

export class PointCloudAccumulator {
  private voxelMap: Map<string, { x: number; y: number; z: number; count: number }>
  private voxelSize: number
  private maxPoints: number
  private minDepth: number
  private maxDepth: number
  private totalFrames: number = 0
  private coverageSet: Set<string> = new Set()

  constructor(options: AccumulatorOptions = {}) {
    this.voxelSize = options.voxelSize ?? 0.005
    this.maxPoints = options.maxPoints ?? 500_000
    this.minDepth = options.minDepth ?? 0.1
    this.maxDepth = options.maxDepth ?? 5.0
    this.voxelMap = new Map()
  }

  /**
   * Add a depth frame to the accumulator
   */
  addFrame(frame: DepthFrame): void {
    const pts = frame.pointCloud
    const numPoints = pts.length / 3

    // Track camera angle for coverage estimation
    const camAngle = Math.atan2(frame.position[2], frame.position[0])
    const angleBucket = Math.round((camAngle * 180) / Math.PI / 10) * 10
    this.coverageSet.add(`${angleBucket}_${Math.round(frame.position[1] * 10)}`)

    for (let i = 0; i < numPoints; i++) {
      const x = pts[i * 3]
      const y = pts[i * 3 + 1]
      const z = pts[i * 3 + 2]

      // Depth filter: only keep points within range
      const distFromCam = Math.sqrt(
        (x - frame.position[0]) ** 2 +
        (y - frame.position[1]) ** 2 +
        (z - frame.position[2]) ** 2
      )
      if (distFromCam < this.minDepth || distFromCam > this.maxDepth) continue

      // Voxel key
      const vx = Math.floor(x / this.voxelSize)
      const vy = Math.floor(y / this.voxelSize)
      const vz = Math.floor(z / this.voxelSize)
      const key = `${vx},${vy},${vz}`

      const existing = this.voxelMap.get(key)
      if (existing) {
        // Average positions within voxel
        existing.x = (existing.x * existing.count + x) / (existing.count + 1)
        existing.y = (existing.y * existing.count + y) / (existing.count + 1)
        existing.z = (existing.z * existing.count + z) / (existing.count + 1)
        existing.count++
      } else {
        if (this.voxelMap.size < this.maxPoints) {
          this.voxelMap.set(key, { x, y, z, count: 1 })
        }
      }
    }

    this.totalFrames++
  }

  /**
   * Get the current merged point cloud as Float32Array [x,y,z,...]
   */
  getPointCloud(): Float32Array {
    const result = new Float32Array(this.voxelMap.size * 3)
    let i = 0
    for (const pt of this.voxelMap.values()) {
      result[i++] = pt.x
      result[i++] = pt.y
      result[i++] = pt.z
    }
    return result
  }

  /**
   * Get point cloud as colored array [x,y,z,r,g,b,...] where color = depth
   */
  getColoredPointCloud(): Float32Array {
    const result = new Float32Array(this.voxelMap.size * 6)
    let i = 0

    // Find Y range for coloring
    let minY = Infinity, maxY = -Infinity
    for (const pt of this.voxelMap.values()) {
      minY = Math.min(minY, pt.y)
      maxY = Math.max(maxY, pt.y)
    }
    const yRange = maxY - minY || 1

    for (const pt of this.voxelMap.values()) {
      result[i++] = pt.x
      result[i++] = pt.y
      result[i++] = pt.z
      // Color by height: blue=low, green=mid, red=high
      const t = (pt.y - minY) / yRange
      result[i++] = t                    // R
      result[i++] = 1 - Math.abs(t - 0.5) * 2  // G
      result[i++] = 1 - t               // B
    }
    return result
  }

  /**
   * Estimate scan quality metrics
   */
  getQualityMetrics(): {
    pointCount: number
    coveragePercent: number
    estimatedDensity: number
    score: number
  } {
    const pointCount = this.voxelMap.size
    // Coverage: unique angles / expected full hemisphere angles (~36 * 3 = 108 buckets)
    const coveragePercent = Math.min(100, (this.coverageSet.size / 108) * 100)

    // Estimate density in points per cubic cm
    const estimatedVolumeCm3 = Math.max(1, pointCount * (this.voxelSize * 100) ** 3)
    const estimatedDensity = pointCount / estimatedVolumeCm3

    // Score: blend of coverage and point count
    const coverageScore = coveragePercent
    const densityScore = Math.min(100, (pointCount / 50000) * 100)
    const score = Math.round(coverageScore * 0.6 + densityScore * 0.4)

    return { pointCount, coveragePercent: Math.round(coveragePercent), estimatedDensity, score }
  }

  /**
   * Get coverage angles for the hemisphere visualization
   */
  getCoverageAngles(): number[] {
    return Array.from(this.coverageSet).map(s => parseInt(s.split('_')[0]))
  }

  /**
   * Apply statistical outlier removal
   */
  removeOutliers(meanKNeighbors: number = 20, stddevMult: number = 2.0): void {
    const pts = Array.from(this.voxelMap.values())
    if (pts.length < meanKNeighbors * 2) return

    // For each point, compute mean distance to k nearest neighbors
    const meanDists: number[] = []
    const k = Math.min(meanKNeighbors, pts.length - 1)

    for (const pt of pts) {
      const dists: number[] = []
      for (const other of pts) {
        if (other === pt) continue
        const d = Math.sqrt(
          (pt.x - other.x) ** 2 +
          (pt.y - other.y) ** 2 +
          (pt.z - other.z) ** 2
        )
        dists.push(d)
      }
      dists.sort((a, b) => a - b)
      const kDists = dists.slice(0, k)
      meanDists.push(kDists.reduce((s, d) => s + d, 0) / k)
    }

    // Compute global mean and stddev
    const globalMean = meanDists.reduce((s, d) => s + d, 0) / meanDists.length
    const globalStd = Math.sqrt(
      meanDists.reduce((s, d) => s + (d - globalMean) ** 2, 0) / meanDists.length
    )
    const threshold = globalMean + stddevMult * globalStd

    // Remove outliers
    let idx = 0
    for (const [key] of this.voxelMap) {
      if (meanDists[idx] > threshold) {
        this.voxelMap.delete(key)
      }
      idx++
    }
  }

  reset(): void {
    this.voxelMap.clear()
    this.coverageSet.clear()
    this.totalFrames = 0
  }

  get pointCount(): number {
    return this.voxelMap.size
  }

  get frameCount(): number {
    return this.totalFrames
  }
}
