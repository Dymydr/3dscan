/**
 * Global Zustand store for scan state management
 */

import { create } from 'zustand'
import type { MeshData } from '@/lib/meshing/poisson'
import type { ScanState } from '@/lib/lidar/types'

interface ScanStore {
  // Scan state
  scanState: ScanState
  setScanState: (state: ScanState) => void

  // Current scan data
  currentScanId: string | null
  setCurrentScanId: (id: string | null) => void

  // Point cloud (live during scan)
  pointCloud: Float32Array | null
  setPointCloud: (pts: Float32Array) => void
  pointCount: number
  setPointCount: (n: number) => void

  // Quality metrics
  coveragePercent: number
  setCoveragePercent: (n: number) => void
  qualityScore: number
  setQualityScore: (n: number) => void
  coverageAngles: number[]
  setCoverageAngles: (angles: number[]) => void

  // Processing state
  processingProgress: number
  processingMessage: string
  setProcessingProgress: (progress: number, message: string) => void

  // Mesh (post-processing)
  mesh: MeshData | null
  setMesh: (mesh: MeshData) => void

  // Demo mode
  isDemoMode: boolean
  setDemoMode: (demo: boolean) => void

  // Error
  error: string | null
  setError: (err: string | null) => void

  // Reset
  reset: () => void
}

export const useScanStore = create<ScanStore>((set) => ({
  scanState: 'idle',
  setScanState: (scanState) => set({ scanState }),

  currentScanId: null,
  setCurrentScanId: (currentScanId) => set({ currentScanId }),

  pointCloud: null,
  setPointCloud: (pointCloud) => set({ pointCloud }),
  pointCount: 0,
  setPointCount: (pointCount) => set({ pointCount }),

  coveragePercent: 0,
  setCoveragePercent: (coveragePercent) => set({ coveragePercent }),
  qualityScore: 0,
  setQualityScore: (qualityScore) => set({ qualityScore }),
  coverageAngles: [],
  setCoverageAngles: (coverageAngles) => set({ coverageAngles }),

  processingProgress: 0,
  processingMessage: '',
  setProcessingProgress: (processingProgress, processingMessage) =>
    set({ processingProgress, processingMessage }),

  mesh: null,
  setMesh: (mesh) => set({ mesh }),

  isDemoMode: false,
  setDemoMode: (isDemoMode) => set({ isDemoMode }),

  error: null,
  setError: (error) => set({ error }),

  reset: () => set({
    scanState: 'idle',
    currentScanId: null,
    pointCloud: null,
    pointCount: 0,
    coveragePercent: 0,
    qualityScore: 0,
    coverageAngles: [],
    processingProgress: 0,
    processingMessage: '',
    mesh: null,
    error: null,
  }),
}))
