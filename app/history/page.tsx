'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { listScans, deleteScan, estimateStorageUsage } from '@/lib/storage/indexeddb'
import type { ScanRecord } from '@/lib/storage/indexeddb'
import { useScanStore } from '@/store/scan-store'

export default function HistoryPage() {
  const router = useRouter()
  const store = useScanStore()
  const [scans, setScans] = useState<ScanRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [storageBytes, setStorageBytes] = useState(0)
  const [deleting, setDeleting] = useState<string | null>(null)

  useEffect(() => {
    loadScans()
  }, [])

  async function loadScans() {
    setLoading(true)
    const [records, storage] = await Promise.all([
      listScans(),
      estimateStorageUsage(),
    ])
    setScans(records)
    setStorageBytes(storage)
    setLoading(false)
  }

  async function handleDelete(id: string) {
    setDeleting(id)
    await deleteScan(id)
    setScans(prev => prev.filter(s => s.id !== id))
    setDeleting(null)
  }

  function handleOpen(scan: ScanRecord) {
    store.setCurrentScanId(scan.id)
    if (scan.hasMesh) {
      router.push(`/viewer?id=${scan.id}`)
    } else {
      router.push(`/process`)
    }
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="px-4 pt-6 pb-4 safe-top">
        <div className="flex items-center justify-between mb-1">
          <h1 className="font-sans font-bold text-2xl text-text">Scan History</h1>
          <button
            onClick={() => { store.reset(); router.push('/scan') }}
            className="btn-accent px-4 py-2 text-sm"
          >
            + New Scan
          </button>
        </div>
        <p className="font-mono text-xs text-text-dim">
          {scans.length} scan{scans.length !== 1 ? 's' : ''} · {formatBytes(storageBytes)} used
        </p>
      </div>

      {/* Scan list */}
      <div className="px-4 pb-8">
        {loading ? (
          <div className="flex flex-col gap-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-24 bg-surface rounded-xl animate-pulse" />
            ))}
          </div>
        ) : scans.length === 0 ? (
          <EmptyState onNewScan={() => { store.reset(); router.push('/scan') }} />
        ) : (
          <div className="flex flex-col gap-3">
            {scans.map((scan) => (
              <ScanCard
                key={scan.id}
                scan={scan}
                onOpen={() => handleOpen(scan)}
                onDelete={() => handleDelete(scan.id)}
                isDeleting={deleting === scan.id}
              />
            ))}
          </div>
        )}
      </div>

      {/* Bottom nav */}
      <div className="fixed bottom-0 inset-x-0 glass-panel border-t border-border px-4 py-3 safe-bottom">
        <div className="flex justify-around">
          <NavButton icon="⊕" label="Scan" onClick={() => { store.reset(); router.push('/scan') }} />
          <NavButton icon="◫" label="History" active onClick={() => {}} />
          <NavButton icon="?" label="Setup" onClick={() => router.push('/setup')} />
        </div>
      </div>
    </div>
  )
}

function ScanCard({
  scan,
  onOpen,
  onDelete,
  isDeleting,
}: {
  scan: ScanRecord
  onOpen: () => void
  onDelete: () => void
  isDeleting: boolean
}) {
  const [confirmDelete, setConfirmDelete] = useState(false)

  const date = new Date(scan.createdAt)
  const timeStr = date.toLocaleDateString('en', { month: 'short', day: 'numeric' })
  const hourStr = date.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })

  return (
    <div className={`glass-panel rounded-xl border transition-all ${
      isDeleting ? 'opacity-50' : 'border-border hover:border-border-bright'
    }`}>
      <button className="w-full p-4 text-left" onClick={onOpen}>
        <div className="flex items-start justify-between gap-3">
          {/* Thumbnail placeholder */}
          <div className="w-16 h-16 rounded-lg bg-surface-2 border border-border flex items-center justify-center flex-shrink-0">
            <div className="text-2xl">{scan.hasMesh ? '⬡' : '◌'}</div>
          </div>

          <div className="flex-1 min-w-0">
            <h3 className="font-sans font-semibold text-sm text-text truncate">{scan.name}</h3>
            <p className="font-mono text-xs text-text-dim mt-0.5">
              {timeStr} at {hourStr}
            </p>
            <div className="flex gap-3 mt-2">
              <Chip label={`${scan.pointCount.toLocaleString()} pts`} />
              {scan.hasMesh && <Chip label="3D Mesh" accent />}
              {scan.dimensions && (
                <Chip label={`${(scan.dimensions.width * 1000).toFixed(0)}×${(scan.dimensions.height * 1000).toFixed(0)}mm`} />
              )}
            </div>
          </div>
        </div>
      </button>

      {/* Delete controls */}
      <div className="border-t border-border/50 px-4 py-2 flex justify-end gap-3">
        {confirmDelete ? (
          <>
            <button
              className="font-mono text-xs text-text-dim"
              onClick={() => setConfirmDelete(false)}
            >
              Cancel
            </button>
            <button
              className="font-mono text-xs text-error"
              onClick={onDelete}
              disabled={isDeleting}
            >
              {isDeleting ? 'Deleting...' : 'Confirm Delete'}
            </button>
          </>
        ) : (
          <button
            className="font-mono text-xs text-text-dim hover:text-error"
            onClick={() => setConfirmDelete(true)}
          >
            Delete
          </button>
        )}
      </div>
    </div>
  )
}

function Chip({ label, accent }: { label: string; accent?: boolean }) {
  return (
    <span className={`font-mono text-xs px-2 py-0.5 rounded ${
      accent
        ? 'bg-accent/10 text-accent border border-accent/30'
        : 'bg-surface-2 text-text-dim'
    }`}>
      {label}
    </span>
  )
}

function NavButton({ icon, label, active, onClick }: {
  icon: string; label: string; active?: boolean; onClick: () => void
}) {
  return (
    <button onClick={onClick} className="flex flex-col items-center gap-1 touch-target px-4">
      <span className={`text-lg ${active ? 'text-accent' : 'text-text-dim'}`}>{icon}</span>
      <span className={`font-mono text-xs ${active ? 'text-accent' : 'text-text-dim'}`}>{label}</span>
    </button>
  )
}

function EmptyState({ onNewScan }: { onNewScan: () => void }) {
  return (
    <div className="text-center py-16">
      <div className="w-24 h-24 border-2 border-border rounded-full flex items-center justify-center mx-auto mb-6">
        <span className="text-4xl text-text-dim">◌</span>
      </div>
      <h2 className="font-sans font-semibold text-lg text-text mb-2">No scans yet</h2>
      <p className="font-mono text-xs text-text-dim mb-6 max-w-xs mx-auto leading-relaxed">
        Use your iPhone&apos;s LiDAR sensor to scan objects and create 3D models for CAD
      </p>
      <button onClick={onNewScan} className="btn-accent px-8 py-4 text-lg">
        Start First Scan
      </button>
    </div>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
