/**
 * Demo mode: generates synthetic depth frames simulating a LiDAR scan
 * of a cylindrical object, so the app can be tested without real hardware.
 */

import type { DepthFrame } from './types'

const DEMO_WIDTH = 64
const DEMO_HEIGHT = 48
const TOTAL_FRAMES = 120  // ~4 seconds at 30fps

let demoFrameIndex = 0
let demoInterval: ReturnType<typeof setInterval> | null = null

interface DemoOptions {
  onFrame: (frame: DepthFrame) => void
  onComplete: () => void
}

/**
 * Generate a synthetic depth frame for a box-shaped object
 */
function generateSyntheticFrame(frameIndex: number): DepthFrame {
  const angle = (frameIndex / TOTAL_FRAMES) * Math.PI * 2
  const radius = 1.2  // orbit radius in meters
  const height = 0.0

  // Camera orbiting around the origin
  const camX = Math.cos(angle) * radius
  const camZ = Math.sin(angle) * radius
  const camY = height + 0.3

  const position = new Float32Array([camX, camY, camZ])
  // Rotation quaternion: camera looking at origin
  const lookAngle = angle + Math.PI
  const rotation = new Float32Array([
    0,
    Math.sin(lookAngle / 2),
    0,
    Math.cos(lookAngle / 2),
  ])

  const intrinsics = {
    fx: DEMO_WIDTH * 0.8,
    fy: DEMO_HEIGHT * 0.8,
    cx: DEMO_WIDTH / 2,
    cy: DEMO_HEIGHT / 2,
    width: DEMO_WIDTH,
    height: DEMO_HEIGHT,
  }

  // Generate depth map for a box (0.3m × 0.4m × 0.3m) at origin
  const depthData = new Float32Array(DEMO_WIDTH * DEMO_HEIGHT)
  const pointCloud: number[] = []

  // Add some Gaussian noise
  const noise = () => (Math.random() - 0.5) * 0.005

  for (let v = 0; v < DEMO_HEIGHT; v += 2) {
    for (let u = 0; u < DEMO_WIDTH; u += 2) {
      const xCam = (u - intrinsics.cx) / intrinsics.fx
      const yCam = (v - intrinsics.cy) / intrinsics.fy

      // Ray from camera toward -Z (camera forward)
      const depth = rayIntersectBox(
        camX, camY, camZ,
        xCam, yCam, -1,
        angle
      )

      if (depth > 0.1 && depth < 3.0) {
        const d = depth + noise()
        depthData[v * DEMO_WIDTH + u] = d

        // Back-project
        const wx = camX + xCam * d
        const wy = camY + yCam * d
        const wz = camZ - d  // camera forward is -Z

        // Rotate to world space (simplified)
        const finalX = wx + noise()
        const finalY = wy + noise()
        const finalZ = wz + noise()

        pointCloud.push(finalX, finalY, finalZ)
      }
    }
  }

  return {
    timestamp: Date.now() + frameIndex * 33,
    depthData,
    width: DEMO_WIDTH,
    height: DEMO_HEIGHT,
    position,
    rotation,
    intrinsics,
    pointCloud: new Float32Array(pointCloud),
  }
}

/**
 * Simple ray-box intersection for a box centered at origin
 */
function rayIntersectBox(
  ox: number, oy: number, oz: number,  // ray origin (camera pos)
  dx: number, dy: number, dz: number,  // ray direction
  _viewAngle: number
): number {
  // Box: [-0.15, -0.2, -0.15] to [0.15, 0.2, 0.15]
  const boxHalfX = 0.15
  const boxHalfY = 0.20
  const boxHalfZ = 0.15
  const boxCy = 0.1  // box sits on ground

  const invDx = dx !== 0 ? 1 / dx : Infinity
  const invDy = dy !== 0 ? 1 / dy : Infinity
  const invDz = dz !== 0 ? 1 / dz : Infinity

  // Translate ray to box-local space
  const lox = ox
  const loy = oy - boxCy
  const loz = oz

  const t1 = (-boxHalfX - lox) * invDx
  const t2 = (boxHalfX - lox) * invDx
  const t3 = (-boxHalfY - loy) * invDy
  const t4 = (boxHalfY - loy) * invDy
  const t5 = (-boxHalfZ - loz) * invDz
  const t6 = (boxHalfZ - loz) * invDz

  const tmin = Math.max(Math.min(t1, t2), Math.min(t3, t4), Math.min(t5, t6))
  const tmax = Math.min(Math.max(t1, t2), Math.max(t3, t4), Math.max(t5, t6))

  if (tmax < 0 || tmin > tmax) return -1

  const t = tmin < 0 ? tmax : tmin

  // Convert parametric t to depth along camera Z axis
  return t > 0 ? Math.abs(t * dz || t) : -1
}

export function startDemoMode(options: DemoOptions): void {
  demoFrameIndex = 0
  if (demoInterval) clearInterval(demoInterval)

  demoInterval = setInterval(() => {
    if (demoFrameIndex >= TOTAL_FRAMES) {
      stopDemoMode()
      options.onComplete()
      return
    }

    const frame = generateSyntheticFrame(demoFrameIndex)
    options.onFrame(frame)
    demoFrameIndex++
  }, 33)  // ~30 fps
}

export function stopDemoMode(): void {
  if (demoInterval) {
    clearInterval(demoInterval)
    demoInterval = null
  }
}

export function isDemoRunning(): boolean {
  return demoInterval !== null
}

export const DEMO_TOTAL_FRAMES = TOTAL_FRAMES
