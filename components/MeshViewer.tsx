'use client'

import { useRef, useMemo, useState } from 'react'
import { Canvas, useThree, useFrame } from '@react-three/fiber'
import { OrbitControls, PerspectiveCamera, Box, Plane } from '@react-three/drei'
import * as THREE from 'three'
import type { MeshData } from '@/lib/meshing/poisson'

interface MeshViewerProps {
  mesh: MeshData
  dimensions?: { width: number; height: number; depth: number }
  onMeasure?: (dist: number) => void
}

interface MeshModelProps {
  mesh: MeshData
  wireframe: boolean
  clippingPlane: THREE.Plane | null
  measuring: boolean
  onMeasurePoints?: (a: THREE.Vector3, b: THREE.Vector3) => void
}

function MeshModel({ mesh, wireframe, clippingPlane, measuring, onMeasurePoints }: MeshModelProps) {
  const measurePoints = useRef<THREE.Vector3[]>([])
  const markerA = useRef<THREE.Mesh>(null)
  const markerB = useRef<THREE.Mesh>(null)

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(mesh.vertices, 3))
    geo.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3))
    geo.setIndex(new THREE.BufferAttribute(mesh.indices, 1))
    geo.computeBoundingBox()
    return geo
  }, [mesh])

  const center = useMemo(() => {
    if (!geometry.boundingBox) return new THREE.Vector3()
    const c = new THREE.Vector3()
    geometry.boundingBox.getCenter(c)
    return c
  }, [geometry])

  const handleClick = (event: THREE.Event) => {
    if (!measuring) return
    const e = event as unknown as { point: THREE.Vector3 }
    const pt = e.point.clone()
    measurePoints.current.push(pt)

    if (measurePoints.current.length === 1 && markerA.current) {
      markerA.current.position.copy(pt)
      markerA.current.visible = true
    } else if (measurePoints.current.length === 2) {
      if (markerB.current) {
        markerB.current.position.copy(pt)
        markerB.current.visible = true
      }
      onMeasurePoints?.(measurePoints.current[0], measurePoints.current[1])
      measurePoints.current = []
    }
  }

  return (
    <group position={[-center.x, -center.y, -center.z]}>
      <mesh
        geometry={geometry}
        castShadow
        receiveShadow
        onClick={handleClick}
      >
        <meshStandardMaterial
          color="#4a7fa5"
          roughness={0.6}
          metalness={0.2}
          wireframe={wireframe}
          clippingPlanes={clippingPlane ? [clippingPlane] : []}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Measurement markers */}
      <mesh ref={markerA} visible={false}>
        <sphereGeometry args={[0.005, 8, 8]} />
        <meshBasicMaterial color="#00e5ff" />
      </mesh>
      <mesh ref={markerB} visible={false}>
        <sphereGeometry args={[0.005, 8, 8]} />
        <meshBasicMaterial color="#ff9900" />
      </mesh>
    </group>
  )
}

export function MeshViewer({ mesh, dimensions, onMeasure }: MeshViewerProps) {
  const [wireframe, setWireframe] = useState(false)
  const [showBBox, setShowBBox] = useState(true)
  const [measuring, setMeasuring] = useState(false)
  const [measureDist, setMeasureDist] = useState<number | null>(null)
  const [clipY, setClipY] = useState<number | null>(null)

  const clippingPlane = useMemo(() => {
    if (clipY === null) return null
    return new THREE.Plane(new THREE.Vector3(0, -1, 0), clipY)
  }, [clipY])

  function handleMeasure(a: THREE.Vector3, b: THREE.Vector3) {
    const dist = a.distanceTo(b) * 1000 // convert m to mm
    setMeasureDist(dist)
    onMeasure?.(dist)
  }

  return (
    <div className="relative w-full h-full">
      {/* 3D Canvas */}
      <Canvas
        shadows
        gl={{ antialias: true, localClippingEnabled: true }}
        onCreated={({ gl }) => {
          gl.setClearColor(new THREE.Color('#0d0f12'), 1)
          gl.shadowMap.enabled = true
        }}
      >
        <PerspectiveCamera makeDefault position={[0.5, 0.5, 1.0]} fov={50} />

        <ambientLight intensity={0.4} />
        <directionalLight position={[2, 4, 2]} intensity={1.0} castShadow />
        <directionalLight position={[-2, 2, -2]} intensity={0.3} />

        <MeshModel
          mesh={mesh}
          wireframe={wireframe}
          clippingPlane={clippingPlane}
          measuring={measuring}
          onMeasurePoints={handleMeasure}
        />

        <gridHelper args={[2, 20, '#1a2030', '#1a2030']} position={[0, -0.5, 0]} />
        <OrbitControls makeDefault enableDamping dampingFactor={0.05} />
      </Canvas>

      {/* Controls overlay */}
      <div className="absolute bottom-4 left-4 right-4 flex flex-col gap-2 pointer-events-auto">
        {/* Dimensions */}
        {dimensions && (
          <div className="glass-panel rounded-xl p-3">
            <p className="font-mono text-xs text-text-dim mb-1">DIMENSIONS</p>
            <div className="flex gap-4">
              <span className="font-mono text-sm text-accent">
                W {(dimensions.width * 1000).toFixed(1)}mm
              </span>
              <span className="font-mono text-sm text-accent">
                H {(dimensions.height * 1000).toFixed(1)}mm
              </span>
              <span className="font-mono text-sm text-accent">
                D {(dimensions.depth * 1000).toFixed(1)}mm
              </span>
            </div>
          </div>
        )}

        {/* Measurement result */}
        {measureDist !== null && (
          <div className="glass-panel rounded-xl p-3 border border-accent/30">
            <p className="font-mono text-xs text-text-dim mb-1">MEASUREMENT</p>
            <p className="font-mono text-lg text-accent">
              {measureDist < 10 ? measureDist.toFixed(2) : measureDist.toFixed(1)} mm
            </p>
            <button
              onClick={() => setMeasureDist(null)}
              className="font-mono text-xs text-text-dim mt-1"
            >
              Clear
            </button>
          </div>
        )}

        {/* Tool buttons */}
        <div className="glass-panel rounded-xl p-2 flex gap-2 flex-wrap">
          <ToolButton
            active={wireframe}
            onClick={() => setWireframe(!wireframe)}
            label="Wire"
          />
          <ToolButton
            active={measuring}
            onClick={() => setMeasuring(!measuring)}
            label={measuring ? 'Measuring...' : 'Measure'}
          />
          <ToolButton
            active={clipY !== null}
            onClick={() => setClipY(clipY === null ? 0 : null)}
            label="Cross-sec"
          />
          <ToolButton
            active={showBBox}
            onClick={() => setShowBBox(!showBBox)}
            label="BBox"
          />
        </div>

        {/* Clipping slider */}
        {clipY !== null && (
          <div className="glass-panel rounded-xl p-3">
            <p className="font-mono text-xs text-text-dim mb-2">CROSS-SECTION</p>
            <input
              type="range"
              min="-1"
              max="1"
              step="0.01"
              value={clipY}
              onChange={(e) => setClipY(parseFloat(e.target.value))}
              className="w-full accent-accent"
            />
          </div>
        )}
      </div>
    </div>
  )
}

function ToolButton({
  active,
  onClick,
  label,
}: {
  active: boolean
  onClick: () => void
  label: string
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-2 rounded-lg text-xs font-mono transition-all touch-target ${
        active
          ? 'bg-accent text-background'
          : 'border border-border text-text-dim hover:border-accent'
      }`}
    >
      {label}
    </button>
  )
}
