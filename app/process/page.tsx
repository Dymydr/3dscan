'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useScanStore } from '@/store/scan-store'
import { loadPointCloud, saveMesh, saveScanRecord, getScanRecord } from '@/lib/storage/indexeddb'
import { computeBoundingBox } from '@/lib/pointcloud/voxel-grid'

export default function ProcessPage() {
  const router = useRouter()
  const store = useScanStore()
  const workerRef = useRef<Worker | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [surfaceArea, setSurfaceArea] = useState<number | null>(null)
  const [volume, setVolume] = useState<number | null>(null)

  useEffect(() => {
    startProcessing()
    return () => {
      workerRef.current?.terminate()
    }
  }, [])

  async function startProcessing() {
    const scanId = store.currentScanId
    if (!scanId) {
      setError('No scan data found. Please start a new scan.')
      return
    }

    store.setProcessingProgress(0, 'Loading point cloud...')

    try {
      // Load point cloud from IndexedDB
      let points = store.pointCloud
      if (!points || points.length === 0) {
        const loaded = await loadPointCloud(scanId)
        if (!loaded || loaded.length === 0) {
          throw new Error('No point cloud data available. Please scan an object first.')
        }
        points = loaded
      }

      const numPoints = points.length / 3
      if (numPoints < 50) {
        throw new Error(`Only ${numPoints} points captured. Scan more of the object for better results.`)
      }

      store.setProcessingProgress(10, `Processing ${numPoints.toLocaleString()} points...`)

      // Create Web Worker
      const worker = new Worker(
        new URL('../../workers/mesh.worker.ts', import.meta.url),
        { type: 'module' }
      )
      workerRef.current = worker

      // Determine voxel size based on point count
      const bbox = computeBoundingBox(points)
      const maxDim = Math.max(...bbox.size)
      const targetResolution = Math.min(64, Math.max(32, Math.cbrt(numPoints) * 1.5))
      const voxelSize = maxDim / targetResolution * 2

      worker.postMessage({
        type: 'reconstruct',
        points: points.buffer,
        voxelSize,
        gridResolution: Math.round(targetResolution),
      }, [points.buffer.slice(0)])

      worker.onmessage = async (event) => {
        const msg = event.data

        if (msg.type === 'progress') {
          store.setProcessingProgress(10 + msg.percent * 0.85, msg.message)
        } else if (msg.type === 'complete') {
          store.setProcessingProgress(98, 'Saving mesh...')
          setSurfaceArea(msg.surfaceArea)
          setVolume(msg.volume)

          const mesh = {
            vertices: new Float32Array(msg.vertices),
            indices: new Uint32Array(msg.indices),
            normals: new Float32Array(msg.normals),
            vertexCount: msg.vertexCount,
            triangleCount: msg.triangleCount,
          }

          store.setMesh(mesh)

          // Save to IndexedDB
          await saveMesh(scanId, mesh)

          // Update scan record with mesh flag
          const record = await getScanRecord(scanId)
          if (record) {
            const meshBbox = computeBoundingBox(mesh.vertices)
            await saveScanRecord({
              ...record,
              hasMesh: true,
              dimensions: {
                width: meshBbox.size[0],
                height: meshBbox.size[1],
                depth: meshBbox.size[2],
              },
            })
          }

          store.setProcessingProgress(100, 'Complete!')
          store.setScanState('complete')

          // Navigate to viewer after short delay
          setTimeout(() => router.push('/viewer'), 800)
        } else if (msg.type === 'error') {
          throw new Error(msg.message)
        }
      }

      worker.onerror = (e) => {
        setError(e.message || 'Worker error during mesh processing')
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      store.setProcessingProgress(0, '')
    }
  }

  const progress = store.processingProgress
  const message = store.processingMessage
  const isComplete = progress >= 100

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="px-6 pt-8 safe-top">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-8 h-8 border border-accent/40 rounded-lg flex items-center justify-center">
            <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          </div>
          <h1 className="font-sans font-bold text-xl text-text">
            Processing Scan
          </h1>
        </div>
        <p className="font-mono text-xs text-text-dim tracking-wide">
          BUILDING 3D MESH FROM POINT CLOUD
        </p>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-8">
        {error ? (
          <ErrorState error={error} onRetry={() => { setError(null); startProcessing() }} onBack={() => router.push('/scan')} />
        ) : (
          <ProcessingState progress={progress} message={message} isComplete={isComplete} surfaceArea={surfaceArea} volume={volume} />
        )}
      </div>
    </div>
  )
}

function ProcessingState({
  progress,
  message,
  isComplete,
  surfaceArea,
  volume,
}: {
  progress: number
  message: string
  isComplete: boolean
  surfaceArea: number | null
  volume: number | null
}) {
  return (
    <div className="w-full max-w-sm">
      {/* Animated visualization */}
      <div className="relative w-48 h-48 mx-auto mb-8">
        {/* Orbiting dots */}
        {[0, 60, 120, 180, 240, 300].map((angle, i) => (
          <div
            key={i}
            className="absolute w-2 h-2 rounded-full bg-accent"
            style={{
              top: '50%',
              left: '50%',
              transform: `rotate(${angle}deg) translateX(60px)`,
              animation: `spin 2s linear infinite`,
              animationDelay: `${i * 0.1}s`,
              opacity: 0.3 + (i / 6) * 0.7,
            }}
          />
        ))}
        {/* Center box visualization */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div
            className="border border-accent/40 rounded"
            style={{
              width: `${40 + progress * 0.4}px`,
              height: `${40 + progress * 0.4}px`,
              background: `rgba(0,229,255,${progress * 0.001})`,
              transform: `rotate(${progress * 1.8}deg)`,
              transition: 'all 0.5s ease',
              boxShadow: progress > 50 ? '0 0 20px rgba(0,229,255,0.3)' : 'none',
            }}
          />
        </div>
      </div>

      {/* Progress bar */}
      <div className="mb-4">
        <div className="flex justify-between mb-2">
          <span className="font-mono text-xs text-text-dim">PROGRESS</span>
          <span className="font-mono text-xs text-accent">{Math.round(progress)}%</span>
        </div>
        <div className="h-2 bg-surface-2 rounded-full overflow-hidden border border-border">
          <div
            className="h-full progress-bar rounded-full transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Stage indicators */}
      <div className="space-y-2 mb-6">
        {PROCESSING_STAGES.map((stage, i) => {
          const stageProgress = i * (100 / PROCESSING_STAGES.length)
          const active = progress >= stageProgress && progress < stageProgress + (100 / PROCESSING_STAGES.length)
          const done = progress >= stageProgress + (100 / PROCESSING_STAGES.length)
          return (
            <div key={i} className={`flex items-center gap-3 transition-opacity ${active || done ? 'opacity-100' : 'opacity-30'}`}>
              <div className={`w-4 h-4 rounded-full border flex items-center justify-center flex-shrink-0 ${
                done ? 'bg-success border-success' : active ? 'border-accent' : 'border-border'
              }`}>
                {done && <span className="text-background text-xs">✓</span>}
                {active && <div className="w-2 h-2 rounded-full bg-accent animate-pulse" />}
              </div>
              <span className={`font-mono text-xs ${active ? 'text-accent' : done ? 'text-success' : 'text-text-dim'}`}>
                {stage}
              </span>
            </div>
          )
        })}
      </div>

      {/* Status message */}
      <p className="font-mono text-sm text-text-dim text-center">{message}</p>

      {/* Results preview */}
      {isComplete && (
        <div className="mt-6 glass-panel rounded-xl p-4 border border-accent/20 fade-in">
          <p className="font-mono text-xs text-accent mb-3 tracking-wide">RECONSTRUCTION COMPLETE</p>
          {surfaceArea !== null && (
            <div className="flex justify-between">
              <span className="font-mono text-xs text-text-dim">Surface Area</span>
              <span className="font-mono text-sm text-text">{(surfaceArea * 1e6).toFixed(0)} mm²</span>
            </div>
          )}
          {volume !== null && (
            <div className="flex justify-between mt-1">
              <span className="font-mono text-xs text-text-dim">Volume</span>
              <span className="font-mono text-sm text-text">{(volume * 1e6).toFixed(0)} mm³</span>
            </div>
          )}
          <p className="font-sans text-xs text-text-dim mt-3 text-center">
            Redirecting to 3D Viewer...
          </p>
        </div>
      )}
    </div>
  )
}

function ErrorState({
  error,
  onRetry,
  onBack,
}: {
  error: string
  onRetry: () => void
  onBack: () => void
}) {
  return (
    <div className="w-full max-w-sm text-center">
      <div className="w-16 h-16 rounded-full border-2 border-error/40 flex items-center justify-center mx-auto mb-4">
        <span className="text-2xl">⚠</span>
      </div>
      <h2 className="font-sans font-bold text-lg text-text mb-2">Processing Failed</h2>
      <p className="font-mono text-xs text-text-dim mb-6 leading-relaxed">{error}</p>
      <div className="flex gap-3">
        <button
          onClick={onBack}
          className="flex-1 py-3 border border-border rounded-lg font-sans text-text-dim"
        >
          New Scan
        </button>
        <button
          onClick={onRetry}
          className="flex-1 py-3 bg-accent text-background rounded-lg font-sans font-bold"
        >
          Retry
        </button>
      </div>
    </div>
  )
}

const PROCESSING_STAGES = [
  'Load point cloud',
  'Voxel downsampling',
  'Normal estimation',
  'Surface reconstruction',
  'Mesh cleanup',
  'Save to device',
]
