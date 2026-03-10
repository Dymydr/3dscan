'use client'

import { useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { useScanStore } from '@/store/scan-store'
import { PointCloudAccumulator } from '@/lib/pointcloud/accumulator'
import { startXRSession, stopXRSession, checkDepthSensingSupport } from '@/lib/lidar/session'
import { startDemoMode, stopDemoMode } from '@/lib/lidar/demo-sequence'
import { generateScanId, saveScanRecord, savePointCloud } from '@/lib/storage/indexeddb'
import type { DepthFrame } from '@/lib/lidar/types'

// Dynamically import heavy components
const ScanHUD = dynamic(() => import('@/components/ScanHUD').then(m => ({ default: m.ScanHUD })), { ssr: false })
const PointCloudViewer = dynamic(() => import('@/components/PointCloudViewer').then(m => ({ default: m.PointCloudViewer })), { ssr: false })

const AUTOSAVE_INTERVAL_MS = 30_000

export default function ScanPage() {
  const router = useRouter()
  const store = useScanStore()

  const accumulatorRef = useRef<PointCloudAccumulator | null>(null)
  const autosaveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const speechSynthRef = useRef<SpeechSynthesis | null>(null)
  const frameCountRef = useRef(0)
  const lastVoiceRef = useRef(0)

  // Initialize
  useEffect(() => {
    store.reset()
    store.setScanState('idle')
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      speechSynthRef.current = window.speechSynthesis
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

    // Update store every 5 frames to reduce re-renders
    if (frameCountRef.current % 5 === 0) {
      const metrics = accumulatorRef.current.getQualityMetrics()
      store.setPointCount(metrics.pointCount)
      store.setCoveragePercent(metrics.coveragePercent)
      store.setQualityScore(metrics.score)
      store.setCoverageAngles(accumulatorRef.current.getCoverageAngles())
      store.setPointCloud(accumulatorRef.current.getColoredPointCloud())

      // Voice guidance (max once per 5 seconds)
      const now = Date.now()
      if (now - lastVoiceRef.current > 5000) {
        if (metrics.coveragePercent < 30) {
          speak('Walk around the object slowly')
        } else if (metrics.coveragePercent < 60) {
          speak('Keep going, scan the top and sides')
        } else if (metrics.score > 70) {
          speak('Good coverage. Ready to process.')
        }
        lastVoiceRef.current = now
      }

      // Haptic feedback on quality milestones
      if (metrics.score > 50 && metrics.score <= 55) {
        triggerHaptic('medium')
      } else if (metrics.score > 75 && metrics.score <= 80) {
        triggerHaptic('heavy')
      }
    }
  }, [store])

  const handleStart = useCallback(async () => {
    store.setScanState('requesting-permission')
    store.setError(null)

    const scanId = generateScanId()
    store.setCurrentScanId(scanId)

    accumulatorRef.current = new PointCloudAccumulator({
      voxelSize: 0.005,
      maxPoints: 300_000,
    })
    frameCountRef.current = 0

    // Check XR support
    const { supported } = await checkDepthSensingSupport()

    if (!supported) {
      // Offer demo mode
      store.setDemoMode(true)
      store.setScanState('scanning')
      speak('Starting demo scan mode')

      startDemoMode({
        onFrame: processFrame,
        onComplete: () => {
          store.setScanState('paused')
          speak('Demo scan complete. Ready to process.')
        },
      })
    } else {
      // Real LiDAR scan
      try {
        store.setDemoMode(false)
        await startXRSession({
          onFrame: processFrame,
          onError: (error) => {
            store.setError(error.message)
            store.setScanState('error')
          },
          onEnd: () => {
            if (store.scanState === 'scanning') {
              store.setScanState('paused')
            }
          },
        })
        store.setScanState('scanning')
        speak('LiDAR scan started. Walk slowly around the object.')
      } catch (e) {
        // Fall back to demo if XR fails (e.g. not installed as PWA)
        store.setDemoMode(true)
        store.setScanState('scanning')
        startDemoMode({
          onFrame: processFrame,
          onComplete: () => store.setScanState('paused'),
        })
      }
    }

    // Start autosave
    autosaveTimerRef.current = setInterval(() => autoSave(scanId), AUTOSAVE_INTERVAL_MS)
  }, [processFrame, store])

  const handlePause = useCallback(() => {
    stopXRSession()
    stopDemoMode()
    store.setScanState('paused')
    speak('Scan paused')
  }, [store])

  const handleResume = useCallback(async () => {
    if (!accumulatorRef.current) return
    const { supported } = await checkDepthSensingSupport()

    if (!supported || store.isDemoMode) {
      store.setScanState('scanning')
      startDemoMode({
        onFrame: processFrame,
        onComplete: () => store.setScanState('paused'),
      })
    } else {
      try {
        await startXRSession({
          onFrame: processFrame,
          onError: (e) => { store.setError(e.message); store.setScanState('error') },
          onEnd: () => { if (store.scanState === 'scanning') store.setScanState('paused') },
        })
        store.setScanState('scanning')
      } catch {
        store.setScanState('scanning')
        startDemoMode({ onFrame: processFrame, onComplete: () => store.setScanState('paused') })
      }
    }
  }, [processFrame, store])

  const handleStop = useCallback(async () => {
    stopXRSession()
    stopDemoMode()

    if (autosaveTimerRef.current) {
      clearInterval(autosaveTimerRef.current)
    }

    const scanId = store.currentScanId
    if (scanId && accumulatorRef.current) {
      await autoSave(scanId)
    }

    router.push('/process')
  }, [store, router])

  async function autoSave(scanId: string) {
    if (!accumulatorRef.current) return
    try {
      const pts = accumulatorRef.current.getPointCloud()
      const metrics = accumulatorRef.current.getQualityMetrics()
      await savePointCloud(scanId, pts)
      await saveScanRecord({
        id: scanId,
        name: `Scan ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        pointCount: metrics.pointCount,
        hasMesh: false,
      })
    } catch (e) {
      console.warn('Autosave failed:', e)
    }
  }

  function speak(text: string) {
    if (!speechSynthRef.current) return
    try {
      speechSynthRef.current.cancel()
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.rate = 1.1
      utterance.volume = 0.7
      speechSynthRef.current.speak(utterance)
    } catch { /* ignore */ }
  }

  function triggerHaptic(style: 'light' | 'medium' | 'heavy') {
    if ('vibrate' in navigator) {
      const pattern = style === 'light' ? [30] : style === 'medium' ? [50, 30, 50] : [100, 50, 100]
      navigator.vibrate(pattern)
    }
  }

  const isScanning = store.scanState === 'scanning'
  const showPointCloud = store.pointCloud && store.pointCloud.length > 0
  const hasError = store.scanState === 'error'

  return (
    <div className="fixed inset-0 bg-background overflow-hidden">
      {/* Live Point Cloud Background */}
      {showPointCloud && (
        <div className="absolute inset-0 z-0 opacity-70">
          <PointCloudViewer
            points={store.pointCloud!}
            autoRotate={!isScanning}
            pointSize={0.004}
          />
        </div>
      )}

      {/* AR Camera placeholder (shown when WebXR is active) */}
      {!showPointCloud && (
        <div className="absolute inset-0 z-0 flex items-center justify-center scan-grid">
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

      {/* Scanning line animation */}
      {isScanning && (
        <div className="absolute inset-0 z-1 overflow-hidden pointer-events-none">
          <div
            className="absolute w-full h-0.5 bg-gradient-to-r from-transparent via-accent to-transparent opacity-30"
            style={{ animation: 'scanLine 3s ease-in-out infinite' }}
          />
        </div>
      )}

      {/* Error state */}
      {hasError && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-20 glass-panel rounded-2xl p-6 mx-4 text-center">
          <div className="text-error text-4xl mb-3">⚠</div>
          <h2 className="font-sans font-bold text-text mb-2">Scan Error</h2>
          <p className="font-mono text-xs text-text-dim mb-4">{store.error}</p>
          <button
            onClick={() => { store.reset(); router.push('/setup') }}
            className="btn-accent px-6 py-3"
          >
            View Setup Guide
          </button>
        </div>
      )}

      {/* HUD overlay */}
      {!hasError && (
        <ScanHUD
          onStart={handleStart}
          onPause={handlePause}
          onResume={handleResume}
          onStop={handleStop}
        />
      )}

      {/* Navigation back */}
      <button
        onClick={() => router.push('/history')}
        className="absolute top-4 left-4 z-20 glass-panel rounded-lg p-2 touch-target"
        style={{ marginTop: 'env(safe-area-inset-top, 0px)' }}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <path d="M3 10h14M3 10l5-5M3 10l5 5" stroke="#7a8899" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      </button>
    </div>
  )
}
