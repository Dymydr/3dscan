'use client'

import { useRef, useMemo } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, PerspectiveCamera } from '@react-three/drei'
import * as THREE from 'three'

interface PointCloudViewerProps {
  points: Float32Array
  className?: string
  autoRotate?: boolean
  pointSize?: number
}

function PointCloud({
  points,
  autoRotate,
  pointSize = 0.005,
}: {
  points: Float32Array
  autoRotate?: boolean
  pointSize?: number
}) {
  const ref = useRef<THREE.Points>(null)

  // Build colored point cloud geometry
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry()
    const numPoints = points.length / 3

    if (numPoints === 0) return geo

    // Find Y range for color mapping
    let minY = Infinity, maxY = -Infinity
    for (let i = 0; i < numPoints; i++) {
      const y = points[i * 3 + 1]
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }

    // Find center for centering the cloud
    let cx = 0, cy = 0, cz = 0
    for (let i = 0; i < numPoints; i++) {
      cx += points[i * 3]; cy += points[i * 3 + 1]; cz += points[i * 3 + 2]
    }
    cx /= numPoints; cy /= numPoints; cz /= numPoints

    const positions = new Float32Array(numPoints * 3)
    const colors = new Float32Array(numPoints * 3)
    const yRange = maxY - minY || 1

    for (let i = 0; i < numPoints; i++) {
      positions[i * 3] = points[i * 3] - cx
      positions[i * 3 + 1] = points[i * 3 + 1] - cy
      positions[i * 3 + 2] = points[i * 3 + 2] - cz

      // Height-based coloring: blue→cyan→green→yellow→red
      const t = (points[i * 3 + 1] - minY) / yRange
      const color = new THREE.Color()
      color.setHSL(0.67 - t * 0.67, 1.0, 0.5)
      colors[i * 3] = color.r
      colors[i * 3 + 1] = color.g
      colors[i * 3 + 2] = color.b
    }

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    return geo
  }, [points])

  useFrame((_, delta) => {
    if (autoRotate && ref.current) {
      ref.current.rotation.y += delta * 0.3
    }
  })

  if (points.length === 0) return null

  return (
    <points ref={ref} geometry={geometry}>
      <pointsMaterial
        size={pointSize}
        vertexColors
        sizeAttenuation
        transparent
        opacity={0.9}
      />
    </points>
  )
}

export function PointCloudViewer({
  points,
  className = '',
  autoRotate = false,
  pointSize,
}: PointCloudViewerProps) {
  return (
    <div className={`w-full h-full bg-background ${className}`}>
      <Canvas
        gl={{ antialias: true, alpha: true }}
        onCreated={({ gl }) => {
          gl.setClearColor(new THREE.Color('#0d0f12'), 1)
        }}
      >
        <PerspectiveCamera makeDefault position={[0, 0.5, 2]} fov={60} />
        <ambientLight intensity={0.5} />
        <pointLight position={[10, 10, 10]} />

        <PointCloud points={points} autoRotate={autoRotate} pointSize={pointSize} />

        <gridHelper args={[4, 20, '#1a2030', '#1a2030']} position={[0, -0.5, 0]} />
        <OrbitControls enablePan enableZoom enableRotate makeDefault />
      </Canvas>
    </div>
  )
}
