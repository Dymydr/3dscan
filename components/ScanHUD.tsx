'use client'

import { useEffect, useRef } from 'react'
import { useScanStore } from '@/store/scan-store'

interface ScanHUDProps {
  onStart: () => void
  onPause: () => void
  onResume: () => void
  onStop: () => void
}

export function ScanHUD({ onStart, onPause, onResume, onStop }: ScanHUDProps) {
  const {
    scanState,
    pointCount,
    coveragePercent,
    qualityScore,
    coverageAngles,
    isDemoMode,
  } = useScanStore()

  const isScanning = scanState === 'scanning'
  const isPaused = scanState === 'paused'
  const isIdle = scanState === 'idle'

  return (
    <div className="fixed inset-0 pointer-events-none z-10 flex flex-col">
      {/* Top Status Bar */}
      <div className="glass-panel mx-4 mt-4 safe-top pointer-events-auto rounded-xl p-3 fade-in">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {isScanning && (
              <div className="w-2.5 h-2.5 rounded-full bg-error animate-pulse" />
            )}
            {isPaused && (
              <div className="w-2.5 h-2.5 rounded-full bg-warning" />
            )}
            {isIdle && (
              <div className="w-2.5 h-2.5 rounded-full bg-text-muted" />
            )}
            <span className="font-mono text-xs tracking-widest text-accent uppercase">
              {isScanning ? 'SCANNING' : isPaused ? 'PAUSED' : 'READY'}
            </span>
            {isDemoMode && (
              <span className="font-mono text-xs text-warning bg-warning/10 px-2 py-0.5 rounded">
                DEMO
              </span>
            )}
          </div>

          <div className="flex items-center gap-4">
            <MetricChip label="PTS" value={formatNumber(pointCount)} />
            <MetricChip label="COV" value={`${coveragePercent}%`} />
            <QualityIndicator score={qualityScore} />
          </div>
        </div>
      </div>

      {/* Center: Scan guide ring */}
      {(isScanning || isPaused) && (
        <div className="flex-1 flex items-center justify-center">
          <ScanGuideRing coverage={coveragePercent} />
        </div>
      )}

      {/* Coverage hemisphere mini-map */}
      {(isScanning || isPaused) && coverageAngles.length > 0 && (
        <div className="absolute right-4 top-24 glass-panel rounded-xl p-3 pointer-events-auto">
          <p className="font-mono text-xs text-text-dim mb-2">COVERAGE</p>
          <CoverageMap angles={coverageAngles} />
        </div>
      )}

      {/* Bottom controls */}
      <div className="glass-panel mx-4 mb-4 safe-bottom pointer-events-auto rounded-xl p-4 fade-in">
        {isIdle && (
          <div className="flex flex-col gap-3">
            <p className="font-sans text-sm text-text-dim text-center">
              Position your iPhone above the object and press Start
            </p>
            <button
              onClick={onStart}
              className="btn-accent w-full py-4 text-lg font-bold tracking-wide touch-target glow-pulse"
            >
              START SCAN
            </button>
          </div>
        )}

        {isScanning && (
          <div className="flex gap-3">
            <button
              onClick={onPause}
              className="flex-1 py-4 border border-border rounded-lg text-text font-semibold touch-target hover:border-accent transition-colors"
            >
              PAUSE
            </button>
            <button
              onClick={onStop}
              className="flex-1 py-4 bg-accent/10 border border-accent rounded-lg text-accent font-semibold touch-target hover:bg-accent hover:text-background transition-all"
            >
              STOP & PROCESS
            </button>
          </div>
        )}

        {isPaused && (
          <div className="flex gap-3">
            <button
              onClick={onResume}
              className="flex-1 py-4 border border-accent rounded-lg text-accent font-semibold touch-target"
            >
              RESUME
            </button>
            <button
              onClick={onStop}
              className="flex-1 py-4 bg-accent text-background rounded-lg font-bold touch-target"
            >
              PROCESS
            </button>
          </div>
        )}

        {/* Scan quality bar */}
        {(isScanning || isPaused) && (
          <div className="mt-3">
            <div className="flex justify-between mb-1">
              <span className="font-mono text-xs text-text-dim">QUALITY</span>
              <span className="font-mono text-xs text-accent">{qualityScore}/100</span>
            </div>
            <div className="h-1.5 bg-surface-2 rounded-full overflow-hidden">
              <div
                className="h-full progress-bar rounded-full transition-all duration-500"
                style={{ width: `${qualityScore}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function MetricChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-right">
      <div className="font-mono text-xs text-text-dim">{label}</div>
      <div className="font-mono text-sm text-accent metric-value">{value}</div>
    </div>
  )
}

function QualityIndicator({ score }: { score: number }) {
  const color = score > 70 ? '#00ff88' : score > 40 ? '#ff9900' : '#ff3d57'
  const label = score > 70 ? 'GOOD' : score > 40 ? 'FAIR' : 'POOR'
  return (
    <div className="text-right">
      <div className="font-mono text-xs text-text-dim">QUAL</div>
      <div className="font-mono text-sm metric-value" style={{ color }}>{label}</div>
    </div>
  )
}

function ScanGuideRing({ coverage }: { coverage: number }) {
  return (
    <div className="relative flex items-center justify-center">
      {/* Outer ring */}
      <div
        className="scan-ring w-64 h-64 rounded-full border-2 border-accent/30"
        style={{ boxShadow: '0 0 40px rgba(0,229,255,0.1)' }}
      />

      {/* Coverage arc */}
      <svg
        className="absolute"
        width="256"
        height="256"
        viewBox="0 0 256 256"
        style={{ transform: 'rotate(-90deg)' }}
      >
        <circle
          cx="128"
          cy="128"
          r="120"
          fill="none"
          stroke="rgba(0,229,255,0.15)"
          strokeWidth="2"
        />
        <circle
          cx="128"
          cy="128"
          r="120"
          fill="none"
          stroke="#00e5ff"
          strokeWidth="2"
          strokeDasharray={`${(coverage / 100) * 2 * Math.PI * 120} ${2 * Math.PI * 120}`}
          strokeLinecap="round"
          style={{ filter: 'drop-shadow(0 0 4px #00e5ff)' }}
        />
      </svg>

      {/* Center crosshair */}
      <div className="absolute">
        <div className="relative w-8 h-8">
          <div className="absolute top-1/2 left-0 w-full h-px bg-accent/60" />
          <div className="absolute left-1/2 top-0 h-full w-px bg-accent/60" />
          <div className="absolute top-1/2 left-1/2 w-2 h-2 -translate-x-1/2 -translate-y-1/2 border border-accent rounded-full" />
        </div>
      </div>

      {/* Coverage label */}
      <div className="absolute bottom-0 translate-y-8">
        <span className="font-mono text-xs text-accent/70">{coverage}% COVERED</span>
      </div>
    </div>
  )
}

function CoverageMap({ angles }: { angles: number[] }) {
  const size = 80
  const center = size / 2
  const r = size / 2 - 4
  const angleSet = new Set(angles)

  const dots = Array.from({ length: 36 }, (_, i) => {
    const angleDeg = i * 10
    const rad = (angleDeg * Math.PI) / 180
    const covered = angleSet.has(angleDeg) || angleSet.has(angleDeg - 10) || angleSet.has(angleDeg + 10)
    const x = center + Math.cos(rad) * r
    const y = center + Math.sin(rad) * r
    return { x, y, covered }
  })

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={center} cy={center} r={r} fill="none" stroke="rgba(42,48,64,0.8)" strokeWidth="1" />
      <circle cx={center} cy={center} r={2} fill="#2a3040" />
      {dots.map((dot, i) => (
        <circle
          key={i}
          cx={dot.x}
          cy={dot.y}
          r={2.5}
          fill={dot.covered ? '#00e5ff' : '#2a3040'}
          style={dot.covered ? { filter: 'drop-shadow(0 0 2px #00e5ff)' } : {}}
        />
      ))}
    </svg>
  )
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}
