import type { XRFrameWithDepth, XRCPUDepthInformation, DepthFrame, CameraIntrinsics } from './types'

export interface XRSessionOptions {
  onFrame: (frame: DepthFrame) => void
  onError: (error: Error) => void
  onEnd: () => void
}

export interface XRStartResult {
  hasDepthSensing: boolean
}

let xrSession: XRSession | null = null
let xrReferenceSpace: XRReferenceSpace | null = null
let xrCanvas: HTMLCanvasElement | null = null
let xrGL: WebGL2RenderingContext | null = null  // stored so we can clear framebuffer each frame

export async function checkARSupport(): Promise<{ supported: boolean; reason?: string }> {
  if (typeof navigator === 'undefined' || !('xr' in navigator)) {
    return { supported: false, reason: 'WebXR not available — open in Safari on iPhone' }
  }
  try {
    const ok = await (navigator as any).xr.isSessionSupported('immersive-ar')
    return ok ? { supported: true } : { supported: false, reason: 'AR not supported on this device/browser' }
  } catch (e) {
    return { supported: false, reason: String(e) }
  }
}

/**
 * Start a WebXR immersive-ar session.
 *
 * Key points:
 * - Do NOT call getUserMedia before this — iOS needs exclusive camera access
 *   and pre-acquiring it via getUserMedia prevents requestSession from working.
 * - depth-sensing is OPTIONAL so the session starts even on non-LiDAR devices.
 * - We store the WebGL context and clear the framebuffer to alpha=0 every frame
 *   so the AR camera feed shows through (without this, the canvas is black).
 */
export async function startXRSession(options: XRSessionOptions): Promise<XRStartResult> {
  if (!('xr' in navigator)) throw new Error('WebXR not supported')

  // Clean up any previous session canvas
  if (xrCanvas) { xrCanvas.remove(); xrCanvas = null; xrGL = null }

  // requestSession triggers the iOS camera permission dialog automatically
  const session = await (navigator as any).xr.requestSession('immersive-ar', {
    requiredFeatures: ['local'],
    optionalFeatures: ['local-floor', 'depth-sensing', 'dom-overlay'],
    depthSensing: {
      usagePreference: ['cpu-optimized'],
      dataFormatPreference: ['luminance-alpha'],
    },
    domOverlay: { root: document.getElementById('ar-overlay') ?? document.body },
  }) as XRSession

  xrSession = session

  // Canvas must be in the DOM for iOS to display the AR camera feed through it.
  // z-index:-1 puts it behind our dom-overlay HUD elements.
  const canvas = document.createElement('canvas')
  canvas.id = 'xr-canvas'
  canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:-1;touch-action:none;'
  document.body.prepend(canvas)
  xrCanvas = canvas

  const gl = canvas.getContext('webgl2', { xrCompatible: true, alpha: true, premultipliedAlpha: false })
  if (!gl) throw new Error('WebGL2 not available')
  xrGL = gl

  await session.updateRenderState({
    baseLayer: new XRWebGLLayer(session, gl, { alpha: true }),
  })

  try {
    xrReferenceSpace = await session.requestReferenceSpace('local-floor')
  } catch {
    xrReferenceSpace = await session.requestReferenceSpace('local')
  }

  // depth-sensing activation: the spec stores depthUsage on the session if granted
  const hasDepthSensing = !!(session as any).depthUsage

  session.addEventListener('end', () => {
    xrCanvas?.remove(); xrCanvas = null; xrGL = null
    options.onEnd()
  })

  session.requestAnimationFrame((time, frame) =>
    onXRFrame(time, frame as XRFrameWithDepth, options)
  )

  return { hasDepthSensing }
}

function onXRFrame(time: number, frame: XRFrameWithDepth, options: XRSessionOptions): void {
  if (!xrSession || !xrReferenceSpace) return

  // Schedule next frame immediately
  xrSession.requestAnimationFrame((t, f) => onXRFrame(t, f as XRFrameWithDepth, options))

  // CRITICAL: clear the XR framebuffer to fully transparent every frame.
  // Without this the canvas renders opaque black and the camera feed is hidden.
  const layer = xrSession.renderState.baseLayer
  if (xrGL && layer) {
    xrGL.bindFramebuffer(xrGL.FRAMEBUFFER, layer.framebuffer)
    xrGL.viewport(0, 0, layer.framebufferWidth, layer.framebufferHeight)
    xrGL.clearColor(0, 0, 0, 0)
    xrGL.clear(xrGL.COLOR_BUFFER_BIT | xrGL.DEPTH_BUFFER_BIT)
  }

  const pose = frame.getViewerPose(xrReferenceSpace)
  if (!pose) return

  for (const view of pose.views) {
    const getDepth = (frame as any).getDepthInformation?.bind(frame)
    const depthInfo: XRCPUDepthInformation | null = getDepth ? getDepth(view) : null
    if (!depthInfo) break  // no depth on this device, stop checking

    const depthFrame = extractDepthFrame(time, view, pose, depthInfo)
    if (depthFrame) options.onFrame(depthFrame)
    break  // single camera in AR
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
    const transform = pose.transform

    const position = new Float32Array([transform.position.x, transform.position.y, transform.position.z])
    const rotation = new Float32Array([transform.orientation.x, transform.orientation.y, transform.orientation.z, transform.orientation.w])
    const intrinsics = extractIntrinsics(view.projectionMatrix, width, height)

    const depthValues = new Float32Array(width * height)
    const pointCloud: number[] = []
    const subsample = 4

    for (let v = 0; v < height; v += subsample) {
      for (let u = 0; u < width; u += subsample) {
        const depthMeters = depthInfo.getDepthInMeters(u / width, v / height)
        if (depthMeters === null || depthMeters <= 0.05 || depthMeters > 5.0) continue
        depthValues[v * width + u] = depthMeters

        const xCam = (u - intrinsics.cx) * depthMeters / intrinsics.fx
        const yCam = (v - intrinsics.cy) * depthMeters / intrinsics.fy
        const zCam = -depthMeters
        const worldPt = transformPoint(xCam, yCam, zCam, transform)
        pointCloud.push(worldPt[0], worldPt[1], worldPt[2])
      }
    }

    return { timestamp, depthData: depthValues, width, height, position, rotation, intrinsics, pointCloud: new Float32Array(pointCloud) }
  } catch (e) {
    console.warn('Depth frame extraction failed:', e)
    return null
  }
}

function extractIntrinsics(projMatrix: Float32Array, width: number, height: number): CameraIntrinsics {
  const fx = (projMatrix[0] * width) / 2
  const fy = (projMatrix[5] * height) / 2
  const cx = ((-projMatrix[8] + 1) * width) / 2
  const cy = ((projMatrix[9] + 1) * height) / 2
  return { fx, fy, cx, cy, width, height }
}

function transformPoint(x: number, y: number, z: number, transform: XRRigidTransform): [number, number, number] {
  const { x: qx, y: qy, z: qz, w: qw } = transform.orientation
  const { x: tx, y: ty, z: tz } = transform.position
  const ix = qw * x + qy * z - qz * y
  const iy = qw * y + qz * x - qx * z
  const iz = qw * z + qx * y - qy * x
  const iw = -qx * x - qy * y - qz * z
  return [
    ix * qw + iw * -qx + iy * -qz - iz * -qy + tx,
    iy * qw + iw * -qy + iz * -qx - ix * -qz + ty,
    iz * qw + iw * -qz + ix * -qy - iy * -qx + tz,
  ]
}

export async function stopXRSession(): Promise<void> {
  if (xrSession) {
    try { await xrSession.end() } catch { /* already ended */ }
    xrSession = null; xrReferenceSpace = null
  }
  if (xrCanvas) { xrCanvas.remove(); xrCanvas = null; xrGL = null }
}

export function isXRSessionActive(): boolean {
  return xrSession !== null
}
