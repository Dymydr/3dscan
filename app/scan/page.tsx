'use client'

import { useEffect, useRef, useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { useScanStore } from '@/store/scan-store'
import { PointCloudAccumulator } from '@/lib/pointcloud/accumulator'
import { checkARSupport, startXRSession, stopXRSession } from '@/lib/lidar/session'
import { startDemoMode, stopDemoMode } from '@/lib/lidar/demo-sequence'
import { generateScanId, saveScanRecord, savePointCloud } from '@/lib/storage/indexeddb'
import type { DepthFrame } from '@/lib/lidar/types'

const ScanHUD = dynamic(() => import('@/components/ScanHUD').then(m => ({ default: m.ScanHUD })), { ssr: false })
const PointCloudViewer = dynamic(() => import('@/components/PointCloudViewer').then(m => ({ default: m.PointCloudViewer })), { ssr: false })

const AUTOSAVE_INTERVAL_MS = 30_000

export default function ScanPage() {
  const router = useRouter()
  const store = useScanStore()
  const [statusMsg, setStatusMsg] = useState<string>('')

  const accumulatorRef = useRef<PointCloudAccumulator | null>(null)
  const autosaveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const speechRef = useRef<SpeechSynthesis | null>(null)
  const frameCountRef = useRef(0)
  const lastVoiceRef = useRef(0)

  useEffect(() => {
    store.reset()
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      speechRef.current = window.speechSynthesis
    }
    return () => {
      stopXRSession()
      stopDemoMode()
      if (autosaveTimerRef.current) clearInterval(autosaveTimerRef.current)
    }
  }, [])

  const processFrame = useCallback((frame: DepthFrame) => {
    if (!accumulatorRef.current) return
    accumulatorRef.current.addFrame(frame)
    frameCountRef.current++

    if (frameCountRef.current % 5 === 0) {
      const metrics = accumulatorRef.current.getQualityMetrics()
      store.setPointCount(metrics.pointCount)
      store.setCoveragePercent(metrics.coveragePercent)
      store.setQualityScore(metrics.score)
      store.setCoverageAngles(accumulatorRef.current.getCoverageAngles())
      store.setPointCloud(accumulatorRef.current.getColoredPointCloud())

      const now = Date.now()
      if (now - lastVoiceRef.current > 5000) {
        if (metrics.coveragePercent < 30) speak('Walk around the object slowly')
        else if (metrics.coveragePercent < 60) speak('Keep going, scan the top and sides')
        else if (metrics.score > 70) speak('Good coverage, ready to process')
        lastVoiceRef.current = now
      }
    }
  }, [store])

  const handleStart = useCallback(async () => {
    store.setScanState('requesting-permission')
    store.setError(null)
    setStatusMsg('Checking support…')

    const scanId = generateScanId()
    store.setCurrentScanId(scanId)
    accumulatorRef.current = new PointCloudAccumulator({ voxelSize: 0.005, maxPoints: 300_000 })
    frameCountRef.current = 0

    const { supported } = await checkARSupport()

    if (!supported) {
      // Desktop or non-AR device → demo mode, no camera needed
      setStatusMsg('')
      store.setDemoMode(true)
      store.setScanState('scanning')
      speak('Demo mode active')
      startDemoMode({ onFrame: processFrame, onComplete: () => store.setScanState('paused') })
      startAutosave(scanId)
      return
    }

    // requestSession triggers the iOS camera permission dialog automatically.
    // Do NOT call getUserMedia first — it takes exclusive camera access
    // and prevents the XR session from starting.
    setStatusMsg('Starting AR — allow camera when prompted…')
    try {
      store.setDemoMode(false)
      const result = await startXRSession({
        onFrame: processFrame,
        onError: (err) => { store.setError(err.message); store.setScanState('error'); setStatusMsg('') },
        onEnd: () => { if (store.scanState === 'scanning') store.setScanState('paused') },
      })

      store.setScanState('scanning')
      setStatusMsg('')

      if (result.hasDepthSensing) {
        speak('LiDAR active. Walk slowly around the object.')
      } else {
        store.setError('no-depth')
        speak('Camera started. LiDAR depth not available — use demo mode for full test.')
      }

      startAutosave(scanId)
    } catch (e) {
      // XR session failed — fall back to demo
      console.warn('XR session failed, using demo:', e)
      store.setDemoMode(true)
      store.setScanState('scanning')
      setStatusMsg('')
      speak('Using demo mode')
      startDemoMode({ onFrame: processFrame, onComplete: () => store.setScanState('paused') })
      startAutosave(scanId)
    }
  }, [processFrame, store])

  const handlePause = useCallback(() => {
    stopXRSession(); stopDemoMode()
    store.setScanState('paused')
    speak('Paused')
  }, [store])

  const handleResume = useCallback(async () => {
    if (store.isDemoMode) {
      store.setScanState('scanning')
      startDemoMode({ onFrame: processFrame, onComplete: () => store.setScanState('paused') })
      return
    }
    setStatusMsg('Resuming…')
    try {
      await startXRSession({
        onFrame: processFrame,
        onError: (e) => { store.setError(e.message); store.setScanState('error') },
        onEnd: () => { if (store.scanState === 'scanning') store.setScanState('paused') },
      })
      store.setScanState('scanning')
      setStatusMsg('')
    } catch {
      store.setDemoMode(true)
      store.setScanState('scanning')
      setStatusMsg('')
      startDemoMode({ onFrame: processFrame, onComplete: () => store.setScanState('paused') })
    }
  }, [processFrame, store])

  const handleStop = useCallback(async () => {
    stopXRSession(); stopDemoMode()
    if (autosaveTimerRef.current) clearInterval(autosaveTimerRef.current)
    const scanId = store.currentScanId
    if (scanId && accumulatorRef.current) await autoSave(scanId)
    router.push('/process')
  }, [store, router])

  function startAutosave(scanId: string) {
    autosaveTimerRef.current = setInterval(() => autoSave(scanId), AUTOSAVE_INTERVAL_MS)
  }

  async function autoSave(scanId: string) {
    if (!accumulatorRef.current) return
    try {
      const pts = accumulatorRef.current.getPointCloud()
      const metrics = accumulatorRef.current.getQualityMetrics()
      await savePointCloud(scanId, pts)
      await saveScanRecord({
        id: scanId,
        name: `Scan ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`,
        createdAt: Date.now(), updatedAt: Date.now(),
        pointCount: metrics.pointCount, hasMesh: false,
      })
    } catch (e) { console.warn('Autosave failed:', e) }
  }

  function speak(text: string) {
    if (!speechRef.current) return
    try {
      speechRef.current.cancel()
      const u = new SpeechSynthesisUtterance(text)
      u.rate = 1.1; u.volume = 0.7
      speechRef.current.speak(u)
    } catch { /* ignore */ }
  }

  const isIdle    = store.scanState === 'idle' || store.scanState === 'requesting-permission'
  const isScanning = store.scanState === 'scanning'
  const isPaused  = store.scanState === 'paused'
  const realError = store.scanState === 'error' && store.error !== 'no-depth'
  const noDepth   = store.error === 'no-depth'
  const showCloud = !!store.pointCloud && store.pointCloud.length > 0

  // In AR mode the root div MUST be transparent — the WebXR canvas behind it
  // shows the live camera feed. Any opaque background here will block the camera.
  const arActive = isScanning || isPaused
  return (
    <div
      id="ar-overlay"
      className="fixed inset-0 overflow-hidden"
      style={{ background: arActive ? 'transparent' : undefined }}
    >
      {/* Dark background only shown before AR starts (idle / demo) */}
      {!arActive && <div className="absolute inset-0 bg-black" />}

      {/* Point cloud overlay — semi-transparent so camera still visible behind it */}
      {showCloud && (
        <div className="absolute inset-0 z-10 pointer-events-none" style={{ opacity: 0.55 }}>
          <PointCloudViewer points={store.pointCloud!} autoRotate={isPaused} pointSize={0.004} />
        </div>
      )}

      {/* Idle placeholder (shown when no AR and no cloud yet) */}
      {isIdle && !showCloud && (
        <div className="absolute inset-0 z-0 flex items-center justify-center scan-grid bg-background">
          <div className="text-center">
            <div className="w-24 h-24 border-2 border-accent/20 rounded-full mx-auto mb-4 flex items-center justify-center scan-ring">
              <div className="w-16 h-16 border-2 border-accent/40 rounded-full flex items-center justify-center">
                <div className="w-8 h-8 border-2 border-accent/60 rounded-full" />
              </div>
            </div>
            <p className="font-mono text-sm text-accent/60 tracking-widest">LIDAR SCANNER</p>
          </div>
        </div>
      )}

      {/* Scan line */}
      {isScanning && (
        <div className="absolute inset-0 z-10 overflow-hidden pointer-events-none">
          <div className="absolute w-full h-0.5 bg-gradient-to-r from-transparent via-accent to-transparent opacity-20"
            style={{ animation: 'scanLine 3s ease-in-out infinite' }} />
        </div>
      )}

      {/* Loading/status overlay */}
      {statusMsg !== '' && (
        <div className="absolute inset-0 z-30 flex items-center justify-center">
          <div className="glass-panel rounded-2xl px-8 py-5 text-center">
            <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="font-mono text-sm text-accent">{statusMsg}</p>
          </div>
        </div>
      )}

      {/* No-depth warning banner */}
      {noDepth && isScanning && (
        <div className="absolute top-20 left-4 right-4 z-20 glass-panel rounded-xl p-3 border border-warning/40">
          <p className="font-mono text-xs text-warning leading-relaxed">
            ⚠ LiDAR depth requires iPhone 12 Pro+ with iOS 16. Camera is active but no depth data.
          </p>
          <button className="font-mono text-xs text-text-dim mt-2 underline"
            onClick={() => store.setError(null)}>Dismiss</button>
        </div>
      )}

      {/* Error overlay */}
      {realError && (
        <div className="absolute inset-0 z-30 bg-background/90 flex items-center justify-center px-6">
          <div className="glass-panel rounded-2xl p-6 text-center max-w-sm w-full border border-error/30">
            <div className="text-4xl mb-3">⚠</div>
            <h2 className="font-sans font-bold text-text mb-2">Camera Error</h2>
            <p className="font-mono text-xs text-text-dim mb-5 leading-relaxed">{store.error}</p>
            <div className="flex gap-3">
              <button onClick={() => router.push('/setup')}
                className="flex-1 py-3 border border-border rounded-lg font-sans text-sm text-text-dim">
                Setup Guide
              </button>
              <button onClick={() => { store.reset(); store.setScanState('idle') }}
                className="flex-1 py-3 bg-accent text-background rounded-lg font-sans font-bold text-sm">
                Try Again
              </button>
            </div>
          </div>
        </div>
      )}

      {/* HUD controls */}
      {!realError && statusMsg === '' && (
        <ScanHUD
          onStart={handleStart}
          onPause={handlePause}
          onResume={handleResume}
          onStop={handleStop}
        />
      )}

      {/* Back button */}
      <button onClick={() => router.push('/history')}
        className="absolute top-4 left-4 z-40 glass-panel rounded-lg p-2 touch-target"
        style={{ marginTop: 'env(safe-area-inset-top, 0px)' }}>
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <path d="M3 10h14M3 10l5-5M3 10l5 5" stroke="#7a8899" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      </button>
    </div>
  )
}
