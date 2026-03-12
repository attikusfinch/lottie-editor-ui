# Lottie Editor

Web-based Lottie animation editor. Load `.json` Lottie files, edit layers, and export the result.

![Dark glassmorphism UI](https://img.shields.io/badge/theme-dark%20glassmorphism-7c3aed)
![No dependencies](https://img.shields.io/badge/deps-zero-22c55e)

## Features

- **Layer Management** — view all layers in a tree, select, rename, delete
- **Drag-to-Move** — select a layer and drag it directly on the canvas
- **Coordinate Editing** — precise X/Y position, anchor point, scale, opacity
- **Color Editing** — change fill, stroke, and gradient colors via color picker
- **Undo (Ctrl+Z)** — up to 50 undo steps
- **Frame Boundaries** — visible canvas frame with corner markers and size label
- **Playback Controls** — play/pause, scrubber, loop toggle
- **Export** — download the edited animation as `.json`
- **Drag & Drop** — drop a `.json` file onto the page to load it

## Tech Stack

Pure vanilla HTML + CSS + JavaScript. No build step, no frameworks.  
Only external dependency: [lottie-web](https://github.com/airbnb/lottie-web) via CDN.

## Getting Started

```bash
# Clone
git clone https://github.com/attikusfinch/lottie-editor-ui.git
cd lottie-editor-ui

# Serve locally (any static server works)
npx -y serve .
```

Open `http://localhost:3000` and load a Lottie `.json` file.

## License

MIT
