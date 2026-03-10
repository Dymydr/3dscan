// WebXR Depth Sensing type augmentations
// These extend the standard WebXR types with depth sensing capabilities

export interface XRDepthInformation {
  width: number
  height: number
  normDepthBufferFromNormView: XRRigidTransform
  rawValueToMeters: number
  getDepthInMeters(x: number, y: number): number | null
}

export interface XRCPUDepthInformation extends XRDepthInformation {
  data: ArrayBuffer
}

export interface XRDepthStateInit {
  usagePreference: ('cpu-optimized' | 'gpu-optimized')[]
  dataFormatPreference: ('luminance-alpha' | 'float32')[]
}

export interface XRSessionWithDepth extends XRSession {
  // Extended session with depth
}

// Note: We use 'any' cast when calling getDepthInformation to avoid
// conflicts with the base XRFrame type definition in @types/webxr
export type XRFrameWithDepth = XRFrame & {
  getDepthInformation(view: XRView): XRCPUDepthInformation | null
}

export interface DepthFrame {
  timestamp: number
  depthData: Float32Array // raw depth values in meters
  width: number
  height: number
  position: Float32Array // camera position [x, y, z]
  rotation: Float32Array // camera rotation quaternion [x, y, z, w]
  intrinsics: CameraIntrinsics
  pointCloud: Float32Array // [x0,y0,z0, x1,y1,z1, ...] world space
}

export interface CameraIntrinsics {
  fx: number // focal length x
  fy: number // focal length y
  cx: number // principal point x
  cy: number // principal point y
  width: number
  height: number
}

export interface ScanSession {
  id: string
  startTime: number
  frames: DepthFrame[]
  totalPoints: number
  coverageAngles: number[] // angles (degrees) from which we've scanned
  quality: ScanQuality
}

export interface ScanQuality {
  pointDensity: number   // points per cubic cm
  coverage: number       // 0-1 percentage of hemisphere covered
  score: number          // 0-100 overall quality score
  warnings: string[]
}

export type ScanState =
  | 'idle'
  | 'requesting-permission'
  | 'scanning'
  | 'paused'
  | 'processing'
  | 'complete'
  | 'error'
