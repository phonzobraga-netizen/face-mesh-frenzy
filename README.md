# Face Mesh Frenzy

## Description
Face Mesh Frenzy is a webcam face-landmark demo with animated neon masks and expression-reactive pulse effects.

## Features
- Real-time face tracking via MediaPipe Face Landmarker
- Three mask styles: Neon Aura, Techno Grid, Wire Dots
- Expression pulse indicator based on mouth openness
- Intensity controls and keyboard shortcuts
- Unit tests for landmark math and pulse logic
- Static Vercel-ready configuration

## Run
```bash
cd face-mesh-frenzy
npm run dev
```
Open `http://127.0.0.1:8104/face-mesh-frenzy/index.html`.

## Test
```bash
cd face-mesh-frenzy
npm test
```

## Deploy
```bash
cd face-mesh-frenzy
npx vercel --prod
```

## Inspiration
- https://github.com/google-ai-edge/mediapipe

## Structure
```text
face-mesh-frenzy/
  index.html
  styles.css
  app.js
  src/
    overlayMath.js
  tests/
    overlayMath.test.js
  package.json
  vercel.json
  README.md
```
