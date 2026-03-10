'use client'

import { useEffect, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import dynamic from 'next/dynamic'
import { useScanStore } from '@/store/scan-store'
import { loadMesh, getScanRecord } from '@/lib/storage/indexeddb'
import { exportSTL, exportOBJ, exportMTL, exportPLY, downloadFile } from '@/lib/export/stl-exporter'
import { computeBoundingBox } from '@/lib/pointcloud/voxel-grid'
import type { MeshData } from '@/lib/meshing/poisson'
import type { ScanRecord } from '@/lib/storage/indexeddb'

const MeshViewer = dynamic(() => import('@/components/MeshViewer').then(m => ({ default: m.MeshViewer })), { ssr: false })

export default function ViewerPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background flex items-center justify-center"><div className="w-10 h-10 border-2 border-accent border-t-transparent rounded-full animate-spin" /></div>}>
      <ViewerContent />
    </Suspense>
  )
}

function ViewerContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const store = useScanStore()

  const [mesh, setMesh] = useState<MeshData | null>(null)
  const [record, setRecord] = useState<ScanRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showExport, setShowExport] = useState(false)
  const [exportScale, setExportScale] = useState(1000)  // meters to mm
  const [measureDist, setMeasureDist] = useState<number | null>(null)

  const scanId = searchParams.get('id') ?? store.currentScanId

  useEffect(() => {
    async function load() {
      try {
        // Use in-memory mesh if available (just processed)
        if (store.mesh && (!scanId || store.currentScanId === scanId)) {
          setMesh(store.mesh)
          if (store.currentScanId) {
            const rec = await getScanRecord(store.currentScanId)
            setRecord(rec)
          }
          setLoading(false)
          return
        }

        // Load from IndexedDB
        if (!scanId) {
          setError('No scan selected. Please start a new scan or choose from history.')
          setLoading(false)
          return
        }

        const [loadedMesh, loadedRecord] = await Promise.all([
          loadMesh(scanId),
          getScanRecord(scanId),
        ])

        if (!loadedMesh) {
          setError('Mesh not found. The scan may not have been processed yet.')
          setLoading(false)
          return
        }

        setMesh(loadedMesh)
        setRecord(loadedRecord)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [scanId, store.mesh, store.currentScanId])

  const dimensions = mesh ? (() => {
    const bbox = computeBoundingBox(mesh.vertices)
    return { width: bbox.size[0], height: bbox.size[1], depth: bbox.size[2] }
  })() : undefined

  async function handleExportSTL() {
    if (!mesh) return
    const buffer = exportSTL(mesh, exportScale)
    const filename = `${record?.name ?? 'scan'}_${exportScale === 1000 ? 'mm' : 'm'}.stl`
    downloadFile(buffer, filename, 'model/stl')
  }

  async function handleExportOBJ() {
    if (!mesh) return
    downloadFile(exportOBJ(mesh, exportScale), 'model.obj', 'text/plain')
    downloadFile(exportMTL(), 'model.mtl', 'text/plain')
  }

  async function handleExportPLY() {
    if (!mesh) return
    const pts = mesh.vertices
    const buffer = exportPLY(pts, exportScale)
    downloadFile(buffer, 'pointcloud.ply', 'application/octet-stream')
  }

  async function handleShare() {
    if (!mesh || !navigator.share) return
    try {
      const buffer = exportSTL(mesh, exportScale)
      const file = new File([buffer], 'scan.stl', { type: 'model/stl' })
      await navigator.share({
        title: 'LiDAR 3D Scan',
        files: [file],
      })
    } catch { /* User cancelled or not supported */ }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-accent border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="font-mono text-xs text-text-dim">LOADING MESH...</p>
        </div>
      </div>
    )
  }

  if (error || !mesh) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6">
        <div className="text-center max-w-sm">
          <div className="text-4xl mb-4">🔍</div>
          <h2 className="font-sans font-bold text-xl text-text mb-2">No Mesh Found</h2>
          <p className="font-mono text-xs text-text-dim mb-6">{error}</p>
          <button onClick={() => router.push('/scan')} className="btn-accent px-8 py-3">
            Start New Scan
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-background flex flex-col">
      {/* Header */}
      <div className="glass-panel px-4 py-3 flex items-center justify-between safe-top z-10">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push('/history')}
            className="touch-target text-text-dim"
          >
            ←
          </button>
          <div>
            <h1 className="font-sans font-semibold text-sm text-text">
              {record?.name ?? '3D Model'}
            </h1>
            <p className="font-mono text-xs text-text-dim">
              {mesh.triangleCount.toLocaleString()} triangles · {mesh.vertexCount.toLocaleString()} vertices
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {typeof navigator !== 'undefined' && 'share' in navigator && (
            <button
              onClick={handleShare}
              className="touch-target text-text-dim hover:text-accent"
            >
              <ShareIcon />
            </button>
          )}
          <button
            onClick={() => setShowExport(!showExport)}
            className="bg-accent text-background px-4 py-2 rounded-lg font-sans font-bold text-sm touch-target"
          >
            Export
          </button>
        </div>
      </div>

      {/* 3D Viewer */}
      <div className="flex-1 relative">
        <MeshViewer
          mesh={mesh}
          dimensions={dimensions}
          onMeasure={setMeasureDist}
        />
      </div>

      {/* Export Panel */}
      {showExport && (
        <div className="glass-panel border-t border-border p-4 safe-bottom z-10 fade-in">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-sans font-bold text-text">Export for OnShape</h3>
            <button onClick={() => setShowExport(false)} className="text-text-dim text-xl">×</button>
          </div>

          {/* Scale setting */}
          <div className="mb-4">
            <label className="font-mono text-xs text-text-dim block mb-2">UNIT SCALE</label>
            <div className="flex gap-2">
              <ScaleButton label="mm (×1000)" value={1000} current={exportScale} onClick={setExportScale} />
              <ScaleButton label="cm (×100)" value={100} current={exportScale} onClick={setExportScale} />
              <ScaleButton label="m (×1)" value={1} current={exportScale} onClick={setExportScale} />
            </div>
          </div>

          {/* Dimensions preview */}
          {dimensions && (
            <div className="glass-panel rounded-xl p-3 mb-4 border border-border">
              <p className="font-mono text-xs text-text-dim mb-1">OUTPUT DIMENSIONS</p>
              <p className="font-mono text-sm text-accent">
                {(dimensions.width * exportScale).toFixed(1)} ×{' '}
                {(dimensions.height * exportScale).toFixed(1)} ×{' '}
                {(dimensions.depth * exportScale).toFixed(1)}
                {exportScale === 1000 ? 'mm' : exportScale === 100 ? 'cm' : 'm'}
              </p>
            </div>
          )}

          {/* Export buttons */}
          <div className="grid grid-cols-2 gap-3 mb-4">
            <ExportButton
              label="STL (Binary)"
              sublabel="Best for OnShape"
              primary
              onClick={handleExportSTL}
            />
            <ExportButton
              label="OBJ + MTL"
              sublabel="Universal 3D"
              onClick={handleExportOBJ}
            />
            <ExportButton
              label="PLY"
              sublabel="Point cloud"
              onClick={handleExportPLY}
            />
            <ExportButton
              label="STEP"
              sublabel="Coming soon"
              disabled
              onClick={() => {}}
            />
          </div>

          {/* OnShape instructions */}
          <details className="glass-panel rounded-xl p-3 border border-border">
            <summary className="font-mono text-xs text-accent cursor-pointer">
              ONSHAPE IMPORT GUIDE
            </summary>
            <ol className="mt-3 space-y-2">
              {ONSHAPE_STEPS.map((step, i) => (
                <li key={i} className="flex gap-2 font-mono text-xs text-text-dim">
                  <span className="text-accent flex-shrink-0">{i + 1}.</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </details>
        </div>
      )}
    </div>
  )
}

function ScaleButton({ label, value, current, onClick }: {
  label: string; value: number; current: number; onClick: (v: number) => void
}) {
  return (
    <button
      onClick={() => onClick(value)}
      className={`flex-1 py-2 px-3 rounded-lg text-xs font-mono transition-all ${
        current === value
          ? 'bg-accent text-background'
          : 'border border-border text-text-dim'
      }`}
    >
      {label}
    </button>
  )
}

function ExportButton({ label, sublabel, primary, disabled, onClick }: {
  label: string; sublabel: string; primary?: boolean; disabled?: boolean; onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`p-3 rounded-xl text-left transition-all border touch-target ${
        disabled
          ? 'border-border opacity-40 cursor-not-allowed'
          : primary
          ? 'border-accent bg-accent/10 hover:bg-accent hover:text-background'
          : 'border-border hover:border-accent'
      }`}
    >
      <p className={`font-sans font-semibold text-sm ${primary ? 'text-accent' : 'text-text'}`}>{label}</p>
      <p className="font-mono text-xs text-text-dim">{sublabel}</p>
    </button>
  )
}

function ShareIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <circle cx="15" cy="4" r="2" stroke="currentColor" strokeWidth="1.5"/>
      <circle cx="15" cy="16" r="2" stroke="currentColor" strokeWidth="1.5"/>
      <circle cx="4" cy="10" r="2" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M6 9l7-4M6 11l7 4" stroke="currentColor" strokeWidth="1.5"/>
    </svg>
  )
}

const ONSHAPE_STEPS = [
  'Open OnShape → Create New Document',
  'Click Import → Select your exported STL file',
  'After import, right-click the part in the Part Studio',
  'Select "Import as solid" for full editing capability',
  'Use Feature Studio → "Mesh to BRep" to convert to NURBS surfaces',
  'You can now dimension, chamfer, and modify the model',
]
