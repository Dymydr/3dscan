import type { XRFrameWithDepth, XRCPUDepthInformation, DepthFrame, CameraIntrinsics } from './types'

export interface XRSessionOptions {
  onFrame: (frame: DepthFrame) => void
  onError: (error: Error) => void
  onEnd: () => void
}

let xrSession: XRSession | null = null
let xrReferenceSpace: XRReferenceSpace | null = null
let animationFrameId: number | null = null

/**
 * Check if WebXR depth sensing is available
 */
export async function checkDepthSensingSupport(): Promise<{
  supported: boolean
  reason?: string
}> {
  if (typeof navigator === 'undefined' || !('xr' in navigator)) {
    return { supported: false, reason: 'WebXR not available in this browser' }
  }

  try {
    const supported = await (navigator as any).xr.isSessionSupported('immersive-ar')
    if (!supported) {
      return { supported: false, reason: 'Immersive AR not supported on this device' }
    }
    return { supported: true }
  } catch (e) {
    return { supported: false, reason: String(e) }
  }
}

/**
 * Request and start a WebXR AR session with depth sensing
 */
export async function startXRSession(options: XRSessionOptions): Promise<void> {
  if (!('xr' in navigator)) {
    throw new Error('WebXR not supported')
  }

  try {
    const session = await (navigator as any).xr.requestSession('immersive-ar', {
      requiredFeatures: ['depth-sensing', 'local-floor'],
      optionalFeatures: ['dom-overlay'],
      depthSensing: {
        usagePreference: ['cpu-optimized'],
        dataFormatPreference: ['luminance-alpha'],
      },
      domOverlay: { root: document.getElementById('ar-overlay') || document.body },
    }) as XRSession

    xrSession = session

    // Set up WebGL context for XR rendering
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2', { xrCompatible: true })
    if (!gl) throw new Error('WebGL2 not available')

    await session.updateRenderState({
      baseLayer: new XRWebGLLayer(session, gl),
    })

    xrReferenceSpace = await session.requestReferenceSpace('local-floor')

    session.addEventListener('end', options.onEnd)

    // Start render loop
    animationFrameId = session.requestAnimationFrame((time, frame) =>
      onXRFrame(time, frame as XRFrameWithDepth, options)
    )
  } catch (error) {
    options.onError(error instanceof Error ? error : new Error(String(error)))
    throw error
  }
}

function onXRFrame(
  time: number,
  frame: XRFrameWithDepth,
  options: XRSessionOptions
): void {
  if (!xrSession || !xrReferenceSpace) return

  // Continue animation loop
  animationFrameId = xrSession.requestAnimationFrame((t, f) =>
    onXRFrame(t, f as XRFrameWithDepth, options)
  )

  const pose = frame.getViewerPose(xrReferenceSpace)
  if (!pose) return

  for (const view of pose.views) {
    const depthInfo = frame.getDepthInformation(view) as XRCPUDepthInformation | null
    if (!depthInfo) continue

    const depthFrame = extractDepthFrame(time, view, pose, depthInfo)
    if (depthFrame) {
      options.onFrame(depthFrame)
    }
    break // Use first view only for AR (single camera)
  }
}

function extractDepthFrame(
  timestamp: number,
  view: XRView,
  pose: XRViewerPose,
  depthInfo: XRCPUDepthInformation
): DepthFrame | null {
  try {
    const { width, height } = depthInfo
    const rawToMeters = depthInfo.rawValueToMeters

    // Extract camera position and rotation from pose
    const transform = pose.transform
    const position = new Float32Array([
      transform.position.x,
      transform.position.y,
      transform.position.z,
    ])
    const rotation = new Float32Array([
      transform.orientation.x,
      transform.orientation.y,
      transform.orientation.z,
      transform.orientation.w,
    ])

    // Extract depth data and build point cloud
    const projectionMatrix = view.projectionMatrix
    const intrinsics = extractIntrinsics(projectionMatrix, width, height)

    // Build point cloud from depth map
    const depthValues = new Float32Array(width * height)
    const pointCloud: number[] = []

    // Sample every Nth pixel to reduce point count (subsample factor)
    const subsample = 4
    for (let v = 0; v < height; v += subsample) {
      for (let u = 0; u < width; u += subsample) {
        const normalizedU = u / width
        const normalizedV = v / height
        const depthMeters = depthInfo.getDepthInMeters(normalizedU, normalizedV)

        if (depthMeters === null || depthMeters <= 0 || depthMeters > 5.0) continue

        depthValues[v * width + u] = depthMeters

        // Back-project to 3D camera space
        const xCam = (u - intrinsics.cx) * depthMeters / intrinsics.fx
        const yCam = (v - intrinsics.cy) * depthMeters / intrinsics.fy
        const zCam = -depthMeters // negative Z = forward in camera space

        // Transform to world space
        const worldPt = transformPoint(xCam, yCam, zCam, transform)
        pointCloud.push(worldPt[0], worldPt[1], worldPt[2])
      }
    }

    return {
      timestamp,
      depthData: depthValues,
      width,
      height,
      position,
      rotation,
      intrinsics,
      pointCloud: new Float32Array(pointCloud),
    }
  } catch (e) {
    console.warn('Failed to extract depth frame:', e)
    return null
  }
}

/**
 * Extract camera intrinsics from WebXR projection matrix
 */
function extractIntrinsics(
  projMatrix: Float32Array,
  width: number,
  height: number
): CameraIntrinsics {
  // WebXR projection matrix is column-major
  // [0]=m00, [4]=m11 contain focal length info
  const fx = (projMatrix[0] * width) / 2
  const fy = (projMatrix[5] * height) / 2
  const cx = ((-projMatrix[8] + 1) * width) / 2
  const cy = ((projMatrix[9] + 1) * height) / 2

  return { fx, fy, cx, cy, width, height }
}

/**
 * Transform a point from camera space to world space
 */
function transformPoint(
  x: number,
  y: number,
  z: number,
  transform: XRRigidTransform
): [number, number, number] {
  const q = transform.orientation
  const t = transform.position

  // Apply quaternion rotation
  const qx = q.x, qy = q.y, qz = q.z, qw = q.w
  const ix = qw * x + qy * z - qz * y
  const iy = qw * y + qz * x - qx * z
  const iz = qw * z + qx * y - qy * x
  const iw = -qx * x - qy * y - qz * z

  const rx = ix * qw + iw * -qx + iy * -qz - iz * -qy
  const ry = iy * qw + iw * -qy + iz * -qx - ix * -qz
  const rz = iz * qw + iw * -qz + ix * -qy - iy * -qx

  return [rx + t.x, ry + t.y, rz + t.z]
}

/**
 * Stop the active XR session
 */
export async function stopXRSession(): Promise<void> {
  if (xrSession) {
    try {
      await xrSession.end()
    } catch {
      // Session may already be ended
    }
    xrSession = null
    xrReferenceSpace = null
    animationFrameId = null
  }
}

export function isXRSessionActive(): boolean {
  return xrSession !== null
}
