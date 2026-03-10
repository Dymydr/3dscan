'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

export default function SetupPage() {
  const router = useRouter()
  const [checkResult, setCheckResult] = useState<{
    isIOS: boolean
    isSafari: boolean
    isHttps: boolean
    isStandalone: boolean
    hasWebXR: boolean
    iosVersion: number | null
  } | null>(null)

  useEffect(() => {
    const ua = navigator.userAgent
    const isIOS = /iPad|iPhone|iPod/.test(ua) && !(window as unknown as { MSStream?: boolean }).MSStream
    const isSafari = /Safari/.test(ua) && !/Chrome/.test(ua)
    const isHttps = location.protocol === 'https:' || location.hostname === 'localhost'
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true
    const hasWebXR = 'xr' in navigator

    // Extract iOS version
    const iosMatch = ua.match(/OS (\d+)_/)
    const iosVersion = iosMatch ? parseInt(iosMatch[1]) : null

    setCheckResult({ isIOS, isSafari, isHttps, isStandalone, hasWebXR, iosVersion })
  }, [])

  const allGood = checkResult?.isIOS && checkResult?.isSafari && checkResult?.isHttps &&
    checkResult?.isStandalone && (checkResult?.iosVersion ?? 0) >= 16

  return (
    <div className="min-h-screen bg-background px-4 py-6 safe-top">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 bg-accent/10 border border-accent/30 rounded-xl flex items-center justify-center">
            <span className="text-accent text-lg">⬡</span>
          </div>
          <div>
            <h1 className="font-sans font-bold text-xl text-text">LiDAR 3D Scanner</h1>
            <p className="font-mono text-xs text-text-dim">Setup Required</p>
          </div>
        </div>
        <p className="font-sans text-sm text-text-dim leading-relaxed">
          To use LiDAR depth sensing, your iPhone needs a few things set up.
          Check each requirement below.
        </p>
      </div>

      {/* Requirements checklist */}
      <div className="space-y-3 mb-8">
        <RequirementCard
          label="iPhone 12 Pro or newer"
          sublabel="LiDAR sensor required (Pro models only)"
          status={checkResult?.isIOS ? 'ok' : checkResult === null ? 'checking' : 'error'}
          detail={checkResult?.isIOS ? 'iOS device detected' : 'Not an iOS device — use demo mode on other devices'}
        />
        <RequirementCard
          label="iOS 16 or later"
          sublabel="Required for WebXR Depth Sensing"
          status={
            checkResult === null ? 'checking' :
            checkResult.iosVersion === null ? 'warning' :
            checkResult.iosVersion >= 16 ? 'ok' : 'error'
          }
          detail={
            checkResult?.iosVersion
              ? `iOS ${checkResult.iosVersion} detected`
              : 'Could not detect iOS version'
          }
        />
        <RequirementCard
          label="Safari Browser"
          sublabel="Chrome/Firefox don't support WebXR on iOS"
          status={checkResult?.isSafari ? 'ok' : checkResult === null ? 'checking' : 'error'}
          detail={checkResult?.isSafari ? 'Safari detected ✓' : 'Open this page in Safari'}
        />
        <RequirementCard
          label="HTTPS Connection"
          sublabel="Camera access requires secure connection"
          status={checkResult?.isHttps ? 'ok' : checkResult === null ? 'checking' : 'error'}
          detail={checkResult?.isHttps ? 'Secure connection ✓' : 'Site must be served over HTTPS'}
        />
        <RequirementCard
          label="Added to Home Screen (PWA)"
          sublabel="WebXR only works when installed as a PWA"
          status={checkResult?.isStandalone ? 'ok' : checkResult === null ? 'checking' : 'warning'}
          detail={checkResult?.isStandalone ? 'Running as PWA ✓' : 'Not installed — follow steps below'}
        />
      </div>

      {/* PWA Install steps (shown if not standalone) */}
      {checkResult && !checkResult.isStandalone && (
        <div className="glass-panel rounded-2xl p-5 border border-border mb-6">
          <h2 className="font-sans font-bold text-base text-text mb-4">
            Install as PWA on iPhone
          </h2>
          <ol className="space-y-4">
            {PWA_STEPS.map((step, i) => (
              <li key={i} className="flex gap-3">
                <div className="w-6 h-6 rounded-full bg-accent/10 border border-accent/30 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <span className="font-mono text-xs text-accent">{i + 1}</span>
                </div>
                <div>
                  <p className="font-sans text-sm text-text">{step.title}</p>
                  {step.detail && (
                    <p className="font-mono text-xs text-text-dim mt-1">{step.detail}</p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Demo mode fallback */}
      {checkResult && (!checkResult.isIOS || !checkResult.isStandalone) && (
        <div className="glass-panel rounded-2xl p-5 border border-warning/20 bg-warning/5 mb-6">
          <h3 className="font-sans font-bold text-base text-warning mb-2">Demo Mode Available</h3>
          <p className="font-sans text-sm text-text-dim mb-4">
            Not on iPhone LiDAR hardware? Use demo mode with a synthetic scan to test
            the full workflow — processing, viewing, and export.
          </p>
          <button
            onClick={() => router.push('/scan')}
            className="w-full py-3 border border-warning/50 text-warning rounded-lg font-sans font-semibold"
          >
            Try Demo Mode
          </button>
        </div>
      )}

      {/* Photogrammetry fallback */}
      <div className="glass-panel rounded-2xl p-5 border border-border mb-6">
        <h3 className="font-sans font-bold text-base text-text mb-2">
          Alternative: Photogrammetry
        </h3>
        <p className="font-sans text-sm text-text-dim mb-3">
          Without LiDAR, use free photogrammetry apps to create 3D models from photos:
        </p>
        <ul className="space-y-2">
          {PHOTOGRAMMETRY_APPS.map((app, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="text-accent mt-0.5">→</span>
              <div>
                <span className="font-sans text-sm font-semibold text-text">{app.name}</span>
                <span className="font-sans text-xs text-text-dim ml-2">{app.desc}</span>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {/* Continue button */}
      {allGood && (
        <button
          onClick={() => router.push('/scan')}
          className="btn-accent w-full py-4 text-lg mb-4 glow-pulse"
        >
          Launch Scanner →
        </button>
      )}

      <button
        onClick={() => router.push('/history')}
        className="w-full py-3 text-text-dim font-sans text-sm"
      >
        View Scan History
      </button>
    </div>
  )
}

function RequirementCard({
  label,
  sublabel,
  status,
  detail,
}: {
  label: string
  sublabel: string
  status: 'ok' | 'error' | 'warning' | 'checking'
  detail?: string
}) {
  const colors = {
    ok: { border: 'border-success/20', bg: 'bg-success/5', icon: '✓', iconColor: 'text-success' },
    error: { border: 'border-error/20', bg: 'bg-error/5', icon: '✗', iconColor: 'text-error' },
    warning: { border: 'border-warning/20', bg: 'bg-warning/5', icon: '!', iconColor: 'text-warning' },
    checking: { border: 'border-border', bg: '', icon: '…', iconColor: 'text-text-dim' },
  }[status]

  return (
    <div className={`rounded-xl p-4 border ${colors.border} ${colors.bg}`}>
      <div className="flex items-start gap-3">
        <div className={`w-6 h-6 rounded-full border flex items-center justify-center flex-shrink-0 mt-0.5 ${colors.border}`}>
          <span className={`font-mono text-xs font-bold ${colors.iconColor}`}>{colors.icon}</span>
        </div>
        <div>
          <p className="font-sans text-sm font-semibold text-text">{label}</p>
          <p className="font-mono text-xs text-text-dim">{sublabel}</p>
          {detail && (
            <p className={`font-mono text-xs mt-1 ${colors.iconColor}`}>{detail}</p>
          )}
        </div>
      </div>
    </div>
  )
}

const PWA_STEPS = [
  {
    title: 'Open this page in Safari on your iPhone',
    detail: 'Safari is required — Chrome and Firefox cannot use WebXR',
  },
  {
    title: 'Tap the Share button (square with arrow)',
    detail: 'Located in the bottom toolbar',
  },
  {
    title: 'Scroll down and tap "Add to Home Screen"',
    detail: 'Then tap "Add" in the top right corner',
  },
  {
    title: 'Open the app from your Home Screen',
    detail: 'It will launch as a full-screen app with WebXR enabled',
  },
  {
    title: 'Allow camera access when prompted',
    detail: 'Required for AR and LiDAR depth sensing',
  },
]

const PHOTOGRAMMETRY_APPS = [
  { name: 'PolyCam', desc: '— Free on iOS, exports OBJ/STL/STEP directly' },
  { name: 'RealityCapture', desc: '— Professional grade, free for personal use' },
  { name: 'KIRI Engine', desc: '— Free cloud processing, 50 photos max' },
  { name: 'Meshroom', desc: '— Open source desktop app (Windows/Linux/Mac)' },
]
