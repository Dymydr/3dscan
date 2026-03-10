# LiDAR 3D Scanner

**Professional 3D scanning for iPhone 15 Pro LiDAR → OnShape CAD**

A production-ready Next.js PWA that uses the iPhone's LiDAR sensor via the WebXR
Depth Sensing API to scan physical objects into 3D meshes, then exports them as
STL/OBJ/PLY files for direct import into OnShape or any other CAD software.

---

## Screenshots

| Scan View | 3D Viewer | Export |
|-----------|-----------|--------|
| *(AR camera + point cloud overlay)* | *(Mesh with measurements)* | *(STL/OBJ/PLY export panel)* |

---

## Features

- **Real LiDAR scanning** via WebXR Depth Sensing API (iOS 16+, iPhone Pro models)
- **Demo mode** — synthetic depth sequence for testing without hardware
- **Live point cloud** visualization during scanning with depth-colored rendering
- **Coverage map** — hemisphere indicator showing which angles have been captured
- **Voice guidance** — "Walk around the object", "Good coverage" via Web Speech API
- **Haptic feedback** on scan quality milestones
- **Mesh reconstruction** — SDF-based Marching Cubes with Laplacian smoothing (Web Worker)
- **3D Viewer** — orbit controls, wireframe, measurement tool, cross-section slider
- **Export** — Binary STL (mm), OBJ+MTL, PLY point cloud
- **Scan history** — IndexedDB persistence with auto-save every 30 seconds
- **PWA** — offline capable, installable to iPhone Home Screen

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 14 (App Router) + TypeScript |
| 3D Rendering | Three.js + @react-three/fiber + @react-three/drei |
| WebXR | Raw WebXR Depth Sensing API |
| State | Zustand |
| Storage | IndexedDB via idb |
| Styling | Tailwind CSS + shadcn/ui components |
| PWA | next-pwa |

---

## Quick Start (Local Development)

```bash
# 1. Clone the repository
git clone https://github.com/your-org/lidar-3d-scanner
cd lidar-3d-scanner

# 2. Install dependencies
npm install --legacy-peer-deps

# 3. Start development server
npm run dev
# → http://localhost:3000

# Note: LiDAR scanning requires HTTPS + iPhone PWA.
# Demo mode works on any browser including desktop Chrome.
```

### Development on HTTPS (for local iOS testing)

WebXR requires HTTPS even on local network. Use a tunnel:

```bash
# Option A: ngrok
ngrok http 3000
# Open the https://xxxx.ngrok.io URL in iPhone Safari

# Option B: local-ssl-proxy
npm install -g local-ssl-proxy
local-ssl-proxy --source 3443 --target 3000
# Open https://localhost:3443 (accept self-signed cert in Settings)
```

---

## Deployment to Vercel (HTTPS Required)

```bash
# 1. Push to GitHub
git push origin main

# 2. Import project at vercel.com/new
# 3. Leave all defaults — Next.js is auto-detected
# 4. Deploy → your-app.vercel.app (auto HTTPS)

# Optional: custom domain
# vercel domains add yourdomain.com
```

Vercel provides HTTPS automatically. The app will work as a PWA immediately.

---

## iPhone Setup (Adding to Home Screen)

WebXR Depth Sensing on iOS **requires** the site to be installed as a PWA.

### Step-by-step:

1. **Open Safari** on your iPhone 12 Pro or newer (iOS 16+)
2. Navigate to your deployed URL (e.g. `https://your-app.vercel.app`)
3. Tap the **Share button** (□↑) in the bottom toolbar
4. Scroll down and tap **"Add to Home Screen"**
5. Tap **"Add"** in the top-right corner
6. Find the **LiDAR Scanner** icon on your Home Screen
7. **Open it from the Home Screen** (not from Safari)
8. Allow **camera access** when prompted
9. Press **"START SCAN"** and walk slowly around your object

### Why PWA-only?

Apple's WebKit restricts WebXR to installed PWAs for privacy/security reasons.
The app will show a setup checklist if any requirement is missing.

---

## LiDAR Hardware Requirements

| Requirement | Details |
|-------------|---------|
| iPhone model | iPhone 12 Pro / 13 Pro / 14 Pro / 15 Pro (or iPad Pro 2020+) |
| iOS version | iOS 16.0 or later |
| Browser | Safari (not Chrome/Firefox — WebXR unsupported) |
| Connection | HTTPS |
| Install method | Added to Home Screen as PWA |

---

## OnShape Workflow

### Importing your scan:

1. **Export STL** from the app (select millimeters for OnShape)
2. Open **OnShape** → Create New Document
3. Click **"Import"** → Select your `.stl` file
4. After import, right-click the mesh in the Part Studio tree
5. Select **"Import as solid"** to enable editing
6. Use **Feature Studio → "Mesh to BRep"** to convert mesh to editable NURBS surfaces
7. Now you can dimension, sketch on faces, add holes, chamfers, etc.

### Scaling tips:

- Scan a known-size reference object (e.g. a credit card, ruler)
- In the viewer's Export panel, enter the reference dimension to auto-scale
- STL files exported in **mm** import at the correct scale in OnShape by default

---

## Architecture

```
/app
  page.tsx              → Root: redirects to /scan or /setup
  layout.tsx            → Global layout, PWA meta tags
  /scan/page.tsx        → Main scanning interface (fullscreen AR)
  /process/page.tsx     → Mesh processing progress screen
  /viewer/page.tsx      → 3D model viewer + export
  /history/page.tsx     → Past scans list with thumbnails
  /setup/page.tsx       → PWA install instructions + requirements check

/lib
  /lidar
    session.ts          → WebXR session management, depth frame capture
    demo-sequence.ts    → Synthetic depth frames for demo mode
    types.ts            → TypeScript interfaces for WebXR depth API

  /pointcloud
    accumulator.ts      → Voxel-grid merging of depth frames
    voxel-grid.ts       → Downsampling, normal estimation, bounding box

  /meshing
    poisson.ts          → SDF + Marching Cubes mesh reconstruction

  /export
    stl-exporter.ts     → Binary STL, OBJ+MTL, PLY exporters

  /storage
    indexeddb.ts        → Scan persistence via idb

/workers
  mesh.worker.ts        → Web Worker: heavy mesh processing
  icp.worker.ts         → Web Worker: point cloud registration

/components
  ScanHUD.tsx           → AR overlay: ring guide, coverage map, controls
  PointCloudViewer.tsx  → Three.js point cloud renderer
  MeshViewer.tsx        → Three.js mesh viewer with tools

/store
  scan-store.ts         → Zustand global state
```

---

## Point Cloud Processing Pipeline

```
LiDAR depth frames
    ↓
Back-projection to world-space 3D points (per frame)
    ↓
Voxel-grid accumulation (5mm voxels, max 300K points)
    ↓
[Web Worker starts]
Voxel downsampling (reduces noise, controls density)
    ↓
Normal estimation (PCA on local neighborhoods)
    ↓
SDF construction (signed distance field on 3D grid)
    ↓
Marching Cubes (isosurface at zero-crossing)
    ↓
Laplacian smoothing (2 passes)
    ↓
Export-ready mesh (vertices, indices, normals)
```

---

## Demo Mode

The app includes a full demo mode that generates a synthetic scan of a box object,
simulating 120 frames of LiDAR data with realistic noise. This lets you:

- Test the full scanning → processing → export workflow
- Develop on desktop without iPhone hardware
- Show the app to stakeholders

Demo mode activates automatically if WebXR is unavailable, or you can click
"Try Demo Mode" on the Setup page.

---

## Performance Notes

- Point cloud processing runs in a **Web Worker** to keep the UI responsive
- Mesh reconstruction for a typical scan (~50K points) takes ~5–15 seconds on M1/A15
- The voxel grid cap (300K points) prevents memory overflow on long scans
- Normal estimation uses a grid-based spatial index for O(n log n) performance
- Binary STL export is ~10× smaller than ASCII STL — preferred for OnShape

---

## Browser Compatibility

| Browser | LiDAR | Demo | Viewer | Export |
|---------|-------|------|--------|--------|
| Safari iOS (PWA) | ✅ | ✅ | ✅ | ✅ |
| Safari iOS (browser) | ❌ | ✅ | ✅ | ✅ |
| Chrome Desktop | ❌ | ✅ | ✅ | ✅ |
| Firefox Desktop | ❌ | ✅ | ✅ | ✅ |
| Chrome Android | Partial* | ✅ | ✅ | ✅ |

*Chrome Android supports WebXR but may not have depth sensing on all devices.

---

## License

MIT — built for the 3D scanning community.
