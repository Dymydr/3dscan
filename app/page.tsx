'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function Home() {
  const router = useRouter()

  useEffect(() => {
    // Check if WebXR depth sensing is potentially available
    // If not, redirect to setup; otherwise to scan
    if (typeof window !== 'undefined' && 'xr' in navigator) {
      router.replace('/scan')
    } else {
      router.replace('/setup')
    }
  }, [router])

  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <div className="flex flex-col items-center gap-4">
        <div className="w-16 h-16 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        <p className="font-mono text-accent text-sm tracking-widest">INITIALIZING</p>
      </div>
    </div>
  )
}
