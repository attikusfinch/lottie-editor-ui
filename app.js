/* ============================================
   Lottie Editor — Main Application Logic
   ============================================ */

(function () {
    'use strict';

    // ─── State ───
    let lottieData = null;         // parsed JSON
    let anim = null;               // lottie-web animation instance
    let selectedLayerIndex = null;  // index in flat layer list
    let flatLayers = [];           // [{layer, path, parent}]
    let isPlaying = true;
    let isLooping = true;

    // ─── Undo history ───
    const undoStack = [];
    const MAX_UNDO = 50;

    // ─── Drag state ───
    let isDragging = false;
    let dragStartMouseX = 0;
    let dragStartMouseY = 0;
    let dragStartLayerX = 0;
    let dragStartLayerY = 0;
    let dragLayerEntry = null;
    let previewScale = 1; // ratio: screen px → lottie units

    // ─── Selection box ───
    let selectionBox = null; // overlay div for selected layer bounding box

    // ─── Tabs ───
    let currentTab = 'colors'; // 'colors' | 'adjust' | 'inspector'
    let originalColors = null; // snapshot for non-destructive HSL adjust

    // ─── DOM refs ───
    const fileInput       = document.getElementById('file-input');
    const btnExport       = document.getElementById('btn-export');
    const fileNameLabel   = document.getElementById('file-name');
    const layersList      = document.getElementById('layers-list');
    const layerCount      = document.getElementById('layer-count');
    const inspectorContent= document.getElementById('inspector-content');
    const lottiePlayer    = document.getElementById('lottie-player');
    const previewEmpty    = document.getElementById('preview-empty');
    const previewContainer= document.getElementById('preview-container');
    const playbackControls= document.getElementById('playback-controls');
    const btnPlayPause    = document.getElementById('btn-play-pause');
    const iconPlay        = document.getElementById('icon-play');
    const iconPause       = document.getElementById('icon-pause');
    const scrubber        = document.getElementById('scrubber');
    const frameLabel      = document.getElementById('frame-label');
    const btnLoop         = document.getElementById('btn-loop');

    // ─── Layer type names ───
    const TYPE_NAMES = {
        0: 'Precomp',
        1: 'Solid',
        2: 'Image',
        3: 'Null',
        4: 'Shape',
        5: 'Text',
        6: 'Audio',
        13: 'Camera',
    };

    const TYPE_ICONS = {
        0: '📦',
        1: '⬛',
        2: '🖼',
        3: '◻️',
        4: '✦',
        5: 'T',
        6: '🔊',
        13: '📷',
    };

    // ═══════════════════════════════════════════
    // Undo System
    // ═══════════════════════════════════════════

    function saveSnapshot() {
        if (!lottieData) return;
        const snap = JSON.stringify(lottieData);
        // Avoid duplicate consecutive snapshots
        if (undoStack.length > 0 && undoStack[undoStack.length - 1] === snap) return;
        undoStack.push(snap);
        if (undoStack.length > MAX_UNDO) undoStack.shift();
    }

    function undo() {
        if (undoStack.length === 0) {
            toast('Nothing to undo', 'info');
            return;
        }
        const snap = undoStack.pop();
        lottieData = JSON.parse(snap);

        // Rebuild everything
        selectedLayerIndex = null;
        renderPreview();
        buildLayersList();
        renderInspector();
        toast('Undo', 'info');
    }

    // Ctrl+Z handler
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
            e.preventDefault();
            undo();
        }
    });

    // ═══════════════════════════════════════════
    // Toast
    // ═══════════════════════════════════════════

    function toast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        const el = document.createElement('div');
        el.className = `toast toast-${type}`;
        el.textContent = message;
        container.appendChild(el);
        setTimeout(() => {
            el.classList.add('toast-out');
            el.addEventListener('animationend', () => el.remove());
        }, 2500);
    }

    // ═══════════════════════════════════════════
    // File Loading
    // ═══════════════════════════════════════════

    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        loadFile(file);
    });

    // Drag & drop
    document.addEventListener('dragover', (e) => {
        e.preventDefault();
        document.body.classList.add('drag-over');
    });
    document.addEventListener('dragleave', (e) => {
        if (e.relatedTarget === null) document.body.classList.remove('drag-over');
    });
    document.addEventListener('drop', (e) => {
        e.preventDefault();
        document.body.classList.remove('drag-over');
        const file = e.dataTransfer.files[0];
        if (file && (file.name.endsWith('.json') || file.name.endsWith('.tgs'))) {
            if (lottieData) {
                mergeFile(file);
            } else {
                loadFile(file);
            }
        } else {
            toast('Please drop a .json or .tgs Lottie file', 'error');
        }
    });

    function loadFile(file) {
        readLottieFile(file, (data) => {
            try {
                if (!data || typeof data !== 'object') {
                    throw new Error('Parsed data is not a valid object');
                }
                lottieData = data;
                // Ensure required fields
                if (!lottieData.layers) lottieData.layers = [];
                if (!Array.isArray(lottieData.layers)) {
                    throw new Error('Invalid Lottie: layers is not an array');
                }
                if (!lottieData.w) lottieData.w = 512;
                if (!lottieData.h) lottieData.h = 512;
                if (!lottieData.fr) lottieData.fr = 30;
                if (lottieData.ip === undefined) lottieData.ip = 0;
                if (lottieData.op === undefined) lottieData.op = 60;
                if (!lottieData.v) lottieData.v = '5.5.2';
                if (!lottieData.assets) lottieData.assets = [];

                fileNameLabel.textContent = file.name;
                btnExport.disabled = false;
                selectedLayerIndex = null;
                undoStack.length = 0;
                toast(`Loaded "${file.name}"`, 'success');
                renderPreview();
                buildLayersList();
                renderInspector();
            } catch (err) {
                console.error('Load error:', err);
                toast('Failed to load: ' + err.message, 'error');
            }
        });
    }

    // Read .json or .tgs (gzipped) file and return parsed JSON
    function readLottieFile(file, callback) {
        if (file.name.endsWith('.tgs')) {
            const reader = new FileReader();
            reader.onload = (ev) => {
                try {
                    const raw = new Uint8Array(ev.target.result);
                    let jsonStr;
                    try {
                        jsonStr = pako.ungzip(raw, { to: 'string' });
                    } catch (gzipErr) {
                        // Maybe not gzipped, try as raw text
                        jsonStr = new TextDecoder('utf-8').decode(raw);
                    }
                    const parsed = JSON.parse(jsonStr);
                    callback(parsed);
                } catch (err) {
                    console.error('TGS parse error:', err);
                    toast('Failed to read TGS: ' + err.message, 'error');
                }
            };
            reader.readAsArrayBuffer(file);
        } else {
            const reader = new FileReader();
            reader.onload = (ev) => {
                try {
                    callback(JSON.parse(ev.target.result));
                } catch (err) {
                    console.error('JSON parse error:', err);
                    toast('Failed to parse JSON: ' + err.message, 'error');
                }
            };
            reader.readAsText(file);
        }
    }

    // ═══════════════════════════════════════════
    // Merge Lottie
    // ═══════════════════════════════════════════

    const mergeInput = document.getElementById('merge-input');

    mergeInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        mergeFile(file);
        mergeInput.value = ''; // reset so same file can be merged again
    });

    function mergeFile(file) {
        if (!lottieData) {
            loadFile(file);
            return;
        }

        readLottieFile(file, (incoming) => {
            try {
                if (!incoming.layers || !Array.isArray(incoming.layers)) {
                    throw new Error('Invalid Lottie: no layers array');
                }
                saveSnapshot();
                mergeLottie(incoming, file.name);
                toast(`Merged "${file.name}" (${incoming.layers.length} layers)`, 'success');
                renderPreview();
                buildLayersList();
                renderInspector();
            } catch (err) {
                toast('Merge failed: ' + err.message, 'error');
            }
        });
    }

    function mergeLottie(incoming, fileName) {
        // 1. Find the max layer index in current data
        let maxInd = 0;
        function findMaxInd(layers) {
            for (const l of layers) {
                if (l.ind !== undefined && l.ind > maxInd) maxInd = l.ind;
            }
        }
        findMaxInd(lottieData.layers);
        if (lottieData.assets) {
            for (const a of lottieData.assets) {
                if (a.layers) findMaxInd(a.layers);
            }
        }
        const indOffset = maxInd + 1;

        // 2. Build asset ID prefix to avoid collisions
        const assetPrefix = '_m' + Date.now() + '_';

        // 3. Process incoming layers — shift ind and parent references
        const clonedLayers = JSON.parse(JSON.stringify(incoming.layers));
        for (const layer of clonedLayers) {
            if (layer.ind !== undefined) layer.ind += indOffset;
            if (layer.parent !== undefined) layer.parent += indOffset;
            // Update precomp refId
            if (layer.ty === 0 && layer.refId) {
                layer.refId = assetPrefix + layer.refId;
            }
            // Update image refId
            if (layer.ty === 2 && layer.refId) {
                layer.refId = assetPrefix + layer.refId;
            }
            // Tag with source file name
            layer.nm = (layer.nm || 'Layer') + ` [${fileName.replace(/\.json$/i, '')}]`;
        }

        // 4. Merge assets
        if (incoming.assets && incoming.assets.length > 0) {
            if (!lottieData.assets) lottieData.assets = [];
            for (const asset of incoming.assets) {
                const cloned = JSON.parse(JSON.stringify(asset));
                cloned.id = assetPrefix + cloned.id;
                // If asset has layers (precomp), shift their indices too
                if (cloned.layers) {
                    for (const l of cloned.layers) {
                        if (l.ind !== undefined) l.ind += indOffset;
                        if (l.parent !== undefined) l.parent += indOffset;
                        if (l.ty === 0 && l.refId) l.refId = assetPrefix + l.refId;
                        if (l.ty === 2 && l.refId) l.refId = assetPrefix + l.refId;
                    }
                }
                lottieData.assets.push(cloned);
            }
        }

        // 5. Expand canvas if incoming is larger
        if (incoming.w > lottieData.w) lottieData.w = incoming.w;
        if (incoming.h > lottieData.h) lottieData.h = incoming.h;

        // 6. Expand frame range if needed
        if (incoming.ip < lottieData.ip) lottieData.ip = incoming.ip;
        if (incoming.op > lottieData.op) lottieData.op = incoming.op;

        // 7. Match frame rate (use the higher one)
        if (incoming.fr && incoming.fr > (lottieData.fr || 30)) {
            lottieData.fr = incoming.fr;
        }

        // 8. Append layers
        lottieData.layers = lottieData.layers.concat(clonedLayers);
    }

    // ═══════════════════════════════════════════
    // Data Sanitizer for lottie-web
    // ═══════════════════════════════════════════

    function sanitizeLottieData(data) {
        // Remove non-standard top-level keys
        delete data.tgs;

        // Ensure required top-level fields
        if (!data.v) data.v = '5.5.2';
        if (!data.fr) data.fr = 30;
        if (data.ip === undefined) data.ip = 0;
        if (data.op === undefined) data.op = 60;
        if (!data.w) data.w = 512;
        if (!data.h) data.h = 512;
        if (!data.assets) data.assets = [];
        if (!data.layers) data.layers = [];

        // Sanitize all layers (top-level and inside assets)
        sanitizeLayers(data.layers);
        for (const asset of data.assets) {
            if (asset.layers) sanitizeLayers(asset.layers);
        }
    }

    function sanitizeLayers(layers) {
        for (const layer of layers) {
            // Ensure name
            if (!layer.nm) layer.nm = 'Layer ' + (layer.ind !== undefined ? layer.ind : '?');

            // Shape layers (ty:4) MUST have shapes array
            if (layer.ty === 4 && !layer.shapes) {
                layer.shapes = [];
            }

            // Precomp layers (ty:0) need refId
            // Image layers (ty:2) need refId

            // Ensure transform object
            if (!layer.ks) {
                layer.ks = {
                    o: { a: 0, k: 100 },
                    r: { a: 0, k: 0 },
                    p: { a: 0, k: [0, 0, 0] },
                    a: { a: 0, k: [0, 0, 0] },
                    s: { a: 0, k: [100, 100, 100] }
                };
            }

            // Ensure ip/op
            if (layer.ip === undefined) layer.ip = 0;
            if (layer.op === undefined) layer.op = 99999;
        }
    }

    // ═══════════════════════════════════════════
    // Preview Rendering
    // ═══════════════════════════════════════════

    function renderPreview() {
        if (anim) {
            anim.destroy();
            anim = null;
        }
        lottiePlayer.innerHTML = '';

        if (!lottieData) {
            previewEmpty.classList.remove('hidden');
            playbackControls.classList.add('hidden');
            return;
        }

        previewEmpty.classList.add('hidden');
        playbackControls.classList.remove('hidden');

        // Size the player
        const w = lottieData.w || 512;
        const h = lottieData.h || 512;
        const maxW = lottiePlayer.parentElement.clientWidth - 40;
        const maxH = lottiePlayer.parentElement.clientHeight - 40;
        previewScale = Math.min(1, maxW / w, maxH / h);
        lottiePlayer.style.width = (w * previewScale) + 'px';
        lottiePlayer.style.height = (h * previewScale) + 'px';

        // Frame boundary helpers
        updateFrameBoundaryMarkers(w, h);

        // Deep clone and sanitize for lottie-web
        const animData = JSON.parse(JSON.stringify(lottieData));
        sanitizeLottieData(animData);

        try {
            anim = lottie.loadAnimation({
                container: lottiePlayer,
                renderer: 'svg',
                loop: isLooping,
                autoplay: true,
                animationData: animData,
            });
        } catch (err) {
            console.error('lottie.loadAnimation error:', err);
            toast('Lottie render error: ' + err.message, 'error');
            return;
        }

        isPlaying = true;
        updatePlayPauseIcon();

        const totalFrames = anim.totalFrames || 0;
        scrubber.max = Math.floor(totalFrames);

        anim.addEventListener('enterFrame', () => {
            const cf = Math.floor(anim.currentFrame);
            scrubber.value = cf;
            frameLabel.textContent = `${cf} / ${Math.floor(totalFrames)}`;
            updateSelectionBox();
        });

        // Update selection box after render
        requestAnimationFrame(() => updateSelectionBox());
    }

    // ═══════════════════════════════════════════
    // Frame Boundary Markers
    // ═══════════════════════════════════════════

    function updateFrameBoundaryMarkers(w, h) {
        // Remove old markers
        previewContainer.querySelectorAll('.frame-corner-tr, .frame-corner-bl, .frame-size-label').forEach(el => el.remove());

        // We need to position corners relative to the player box
        // Use a small delay so the player has been laid out
        requestAnimationFrame(() => {
            const playerRect = lottiePlayer.getBoundingClientRect();
            const containerRect = previewContainer.getBoundingClientRect();

            const top = playerRect.top - containerRect.top;
            const left = playerRect.left - containerRect.left;
            const right = left + playerRect.width;
            const bottom = top + playerRect.height;

            // Top-right corner
            const trCorner = document.createElement('div');
            trCorner.className = 'frame-corner-tr';
            trCorner.style.top = (top - 1) + 'px';
            trCorner.style.left = (right - 12 + 1) + 'px';
            previewContainer.appendChild(trCorner);

            // Bottom-left corner
            const blCorner = document.createElement('div');
            blCorner.className = 'frame-corner-bl';
            blCorner.style.top = (bottom - 12 + 1) + 'px';
            blCorner.style.left = (left - 1) + 'px';
            previewContainer.appendChild(blCorner);

            // Size label
            const sizeLabel = document.createElement('div');
            sizeLabel.className = 'frame-size-label';
            sizeLabel.textContent = `${w} × ${h}`;
            sizeLabel.style.top = (bottom + 6) + 'px';
            sizeLabel.style.left = (left + playerRect.width / 2) + 'px';
            sizeLabel.style.transform = 'translateX(-50%)';
            previewContainer.appendChild(sizeLabel);
        });
    }

    // ═══════════════════════════════════════════
    // Drag-to-Move on Canvas
    // ═══════════════════════════════════════════

    lottiePlayer.addEventListener('mousedown', (e) => {
        if (!lottieData) return;
        if (selectedLayerIndex === null || !flatLayers[selectedLayerIndex]) return;

        const entry = flatLayers[selectedLayerIndex];
        const ks = entry.layer.ks;
        if (!ks || !ks.p) return;

        // Save snapshot before drag starts
        saveSnapshot();

        isDragging = true;
        dragLayerEntry = entry;
        dragStartMouseX = e.clientX;
        dragStartMouseY = e.clientY;

        const pos = getStaticOrFirstKeyframe(ks.p);
        dragStartLayerX = pos[0];
        dragStartLayerY = pos[1];

        // Pause animation during drag for responsive feedback
        if (anim && isPlaying) {
            anim.pause();
        }

        lottiePlayer.style.cursor = 'grabbing';
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDragging || !dragLayerEntry) return;

        const dx = (e.clientX - dragStartMouseX) / previewScale;
        const dy = (e.clientY - dragStartMouseY) / previewScale;

        const newX = Math.round(dragStartLayerX + dx);
        const newY = Math.round(dragStartLayerY + dy);

        const ks = dragLayerEntry.layer.ks;
        setStaticOrFirstKeyframe(ks.p, [newX, newY]);

        // Live re-render preview
        renderPreviewSilent();

        // Update inspector inputs if visible
        const inpX = document.getElementById('inp-pos-x');
        const inpY = document.getElementById('inp-pos-y');
        if (inpX) inpX.value = newX;
        if (inpY) inpY.value = newY;
    });

    document.addEventListener('mouseup', () => {
        if (!isDragging) return;
        isDragging = false;
        dragLayerEntry = null;
        lottiePlayer.style.cursor = '';

        // Resume playing if it was playing
        if (anim && isPlaying) {
            anim.play();
        }
    });

    // Silent re-render that doesn't reset playback state
    function renderPreviewSilent() {
        if (!anim || !lottieData) return;
        const currentFrame = anim.currentFrame;
        anim.destroy();
        lottiePlayer.innerHTML = '';

        const animData = JSON.parse(JSON.stringify(lottieData));
        sanitizeLottieData(animData);

        try {
            anim = lottie.loadAnimation({
                container: lottiePlayer,
                renderer: 'svg',
                loop: isLooping,
                autoplay: false,
                animationData: animData,
            });
        } catch (err) {
            console.error('lottie silent render error:', err);
            return;
        }

        anim.goToAndStop(currentFrame, true);

        const totalFrames = anim.totalFrames || 0;
        anim.addEventListener('enterFrame', () => {
            const cf = Math.floor(anim.currentFrame);
            scrubber.value = cf;
            frameLabel.textContent = `${cf} / ${Math.floor(totalFrames)}`;
        });
    }

    // ═══════════════════════════════════════════
    // Playback Controls
    // ═══════════════════════════════════════════

    btnPlayPause.addEventListener('click', () => {
        if (!anim) return;
        if (isPlaying) {
            anim.pause();
        } else {
            anim.play();
        }
        isPlaying = !isPlaying;
        updatePlayPauseIcon();
    });

    function updatePlayPauseIcon() {
        iconPlay.classList.toggle('hidden', isPlaying);
        iconPause.classList.toggle('hidden', !isPlaying);
    }

    scrubber.addEventListener('input', () => {
        if (!anim) return;
        anim.goToAndStop(parseInt(scrubber.value), true);
        isPlaying = false;
        updatePlayPauseIcon();
    });

    btnLoop.addEventListener('click', () => {
        isLooping = !isLooping;
        btnLoop.classList.toggle('active', isLooping);
        if (anim) anim.loop = isLooping;
    });

    // ═══════════════════════════════════════════
    // Layers List
    // ═══════════════════════════════════════════

    function buildFlatLayers() {
        flatLayers = [];
        if (!lottieData || !lottieData.layers) return;

        function walk(layers, depth, parentPath) {
            for (let i = 0; i < layers.length; i++) {
                const layer = layers[i];
                const path = parentPath.concat(i);
                flatLayers.push({ layer, path, depth });
                // Precomp children are in assets
                if (layer.ty === 0 && layer.refId && lottieData.assets) {
                    const asset = lottieData.assets.find(a => a.id === layer.refId);
                    if (asset && asset.layers) {
                        walk(asset.layers, depth + 1, ['asset', layer.refId]);
                    }
                }
            }
        }
        walk(lottieData.layers, 0, []);
    }

    function buildLayersList() {
        buildFlatLayers();
        layerCount.textContent = flatLayers.length;
        layersList.innerHTML = '';

        if (flatLayers.length === 0) {
            layersList.innerHTML = `
                <div class="empty-state">
                    <p>No layers found</p>
                </div>`;
            return;
        }

        flatLayers.forEach((entry, idx) => {
            const { layer, depth } = entry;
            const item = document.createElement('div');
            item.className = 'layer-item' + (idx === selectedLayerIndex ? ' selected' : '');
            item.style.paddingLeft = (10 + depth * 16) + 'px';
            item.dataset.index = idx;

            const icon = document.createElement('div');
            icon.className = 'layer-icon';
            icon.textContent = TYPE_ICONS[layer.ty] || '?';

            const name = document.createElement('span');
            name.className = 'layer-name';
            name.textContent = layer.nm || `Layer ${layer.ind ?? idx}`;

            const tag = document.createElement('span');
            tag.className = 'layer-type-tag';
            tag.textContent = TYPE_NAMES[layer.ty] || `ty:${layer.ty}`;

            const delBtn = document.createElement('button');
            delBtn.className = 'layer-delete-btn';
            delBtn.title = 'Delete layer';
            delBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 3.5l8 8M11 3.5l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
            delBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                deleteLayer(idx);
            });

            item.appendChild(icon);
            item.appendChild(name);
            item.appendChild(tag);
            item.appendChild(delBtn);

            item.addEventListener('click', () => selectLayer(idx));
            layersList.appendChild(item);
        });
    }

    function selectLayer(idx) {
        // Toggle: clicking already-selected layer deselects it
        if (selectedLayerIndex === idx) {
            selectedLayerIndex = null;
            layersList.querySelectorAll('.layer-item').forEach(el => el.classList.remove('selected'));
            lottiePlayer.style.cursor = '';
            // Switch to colors tab
            currentTab = 'colors';
            document.querySelectorAll('.inspector-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'colors'));
            renderActiveTab();
            updateSelectionBox();
            return;
        }

        selectedLayerIndex = idx;
        // Switch to inspector tab
        currentTab = 'inspector';
        document.querySelectorAll('.inspector-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'inspector'));
        // Update selection visuals
        layersList.querySelectorAll('.layer-item').forEach((el, i) => {
            el.classList.toggle('selected', i === idx);
        });
        renderInspector();
        updateSelectionBox();
        // Change cursor to grab when a layer is selected
        if (flatLayers[idx] && flatLayers[idx].layer.ks && flatLayers[idx].layer.ks.p) {
            lottiePlayer.style.cursor = 'grab';
        } else {
            lottiePlayer.style.cursor = '';
        }
    }

    // ═══════════════════════════════════════════
    // Selection Bounding Box
    // ═══════════════════════════════════════════

    function ensureSelectionBox() {
        if (!selectionBox) {
            selectionBox = document.createElement('div');
            selectionBox.className = 'selection-box';
            selectionBox.innerHTML = '<div class="sel-corner tl"></div><div class="sel-corner tr"></div><div class="sel-corner bl"></div><div class="sel-corner br"></div>';
            previewContainer.appendChild(selectionBox);
        }
        return selectionBox;
    }

    function updateSelectionBox() {
        const box = ensureSelectionBox();

        if (selectedLayerIndex === null || !anim || !flatLayers[selectedLayerIndex]) {
            box.style.display = 'none';
            return;
        }

        const entry = flatLayers[selectedLayerIndex];
        const svgGroup = findRenderedLayerElement(entry);

        if (!svgGroup) {
            box.style.display = 'none';
            return;
        }

        try {
            const groupRect = svgGroup.getBoundingClientRect();
            const containerRect = previewContainer.getBoundingClientRect();

            // Skip if the element has no visible area
            if (groupRect.width < 1 && groupRect.height < 1) {
                box.style.display = 'none';
                return;
            }

            const x = groupRect.left - containerRect.left;
            const y = groupRect.top - containerRect.top;

            box.style.display = 'block';
            box.style.left = x + 'px';
            box.style.top = y + 'px';
            box.style.width = groupRect.width + 'px';
            box.style.height = groupRect.height + 'px';
        } catch (e) {
            box.style.display = 'none';
        }
    }

    function findRenderedLayerElement(entry) {
        if (!anim || !anim.renderer || !anim.renderer.elements) return null;

        const { layer, path } = entry;

        // For top-level layers, match by index in the layers array
        if (path[0] !== 'asset') {
            const layerArrayIndex = path[path.length - 1];
            const el = anim.renderer.elements[layerArrayIndex];
            if (el) {
                return el.baseElement || el.layerElement || null;
            }
        } else {
            // For precomp children, try to find by layer ind
            for (const el of anim.renderer.elements) {
                if (el && el.elements) {
                    // This is a precomp, look inside
                    const childIdx = path[path.length - 1];
                    const child = el.elements[childIdx];
                    if (child) {
                        return child.baseElement || child.layerElement || null;
                    }
                }
            }
        }

        return null;
    }

    // ═══════════════════════════════════════════
    // Inspector Tabs
    // ═══════════════════════════════════════════

    document.querySelectorAll('.inspector-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            currentTab = tab.dataset.tab;
            document.querySelectorAll('.inspector-tab').forEach(t => t.classList.toggle('active', t === tab));
            renderActiveTab();
        });
    });

    function renderActiveTab() {
        if (!lottieData) {
            inspectorContent.innerHTML = `
                <div class="empty-state">
                    <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
                        <circle cx="24" cy="24" r="18" stroke="currentColor" stroke-width="2" opacity=".2"/>
                        <path d="M24 16v8M24 28v2" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" opacity=".3"/>
                    </svg>
                    <p>Load a file to begin</p>
                </div>`;
            return;
        }

        switch (currentTab) {
            case 'colors':
                selectedLayerIndex = null;
                layersList.querySelectorAll('.layer-item').forEach(el => el.classList.remove('selected'));
                updateSelectionBox();
                renderGlobalColorPalette();
                break;
            case 'adjust':
                renderAdjustPanel();
                break;
            case 'inspector':
                renderInspector();
                break;
        }
    }

    // ═══════════════════════════════════════════
    // HSL Adjust Panel
    // ═══════════════════════════════════════════

    function rgbToHsl(r, g, b) {
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        let h = 0, s = 0, l = (max + min) / 2;
        if (max !== min) {
            const d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
            else if (max === g) h = ((b - r) / d + 2) / 6;
            else h = ((r - g) / d + 4) / 6;
        }
        return [h, s, l];
    }

    function hslToRgb(h, s, l) {
        let r, g, b;
        if (s === 0) {
            r = g = b = l;
        } else {
            const hue2rgb = (p, q, t) => {
                if (t < 0) t += 1;
                if (t > 1) t -= 1;
                if (t < 1/6) return p + (q - p) * 6 * t;
                if (t < 1/2) return q;
                if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
                return p;
            };
            const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
            const p = 2 * l - q;
            r = hue2rgb(p, q, h + 1/3);
            g = hue2rgb(p, q, h);
            b = hue2rgb(p, q, h - 1/3);
        }
        return [r, g, b];
    }

    function captureOriginalColors() {
        originalColors = [];
        flatLayers.forEach(entry => {
            const layerColors = extractColors(entry.layer);
            layerColors.forEach(c => {
                originalColors.push({
                    color: [c.color[0], c.color[1], c.color[2]],
                    setter: c.setter,
                });
            });
        });
    }

    function applyHslAdjust(hueShift, satShift, lightShift) {
        if (!originalColors) return;
        originalColors.forEach(oc => {
            const [h, s, l] = rgbToHsl(oc.color[0], oc.color[1], oc.color[2]);
            let newH = (h + hueShift / 360) % 1;
            if (newH < 0) newH += 1;
            let newS = Math.max(0, Math.min(1, s + satShift / 100));
            let newL = Math.max(0, Math.min(1, l + lightShift / 100));
            const [r, g, b] = hslToRgb(newH, newS, newL);
            oc.setter([r, g, b]);
        });
    }

    function renderAdjustPanel() {
        if (!lottieData || flatLayers.length === 0) {
            inspectorContent.innerHTML = `
                <div class="empty-state"><p>Load a file first</p></div>`;
            return;
        }

        // Capture original colors when entering adjust tab
        captureOriginalColors();

        inspectorContent.innerHTML = `
            <div class="inspector-section">
                <div class="inspector-section-title">HSL Adjustment</div>
                <div class="adjust-section">
                    <div class="adjust-row">
                        <span class="adjust-label">Hue</span>
                        <input type="range" class="adjust-slider" id="adj-hue" min="-180" max="180" value="0" step="1">
                        <span class="adjust-value" id="adj-hue-val">0°</span>
                    </div>
                    <div class="adjust-row">
                        <span class="adjust-label">Saturation</span>
                        <input type="range" class="adjust-slider" id="adj-sat" min="-100" max="100" value="0" step="1">
                        <span class="adjust-value" id="adj-sat-val">0%</span>
                    </div>
                    <div class="adjust-row">
                        <span class="adjust-label">Lightness</span>
                        <input type="range" class="adjust-slider" id="adj-light" min="-100" max="100" value="0" step="1">
                        <span class="adjust-value" id="adj-light-val">0%</span>
                    </div>
                    <button class="adjust-reset-btn" id="adj-reset">Reset Adjustments</button>
                </div>
            </div>`;

        const hueSlider = document.getElementById('adj-hue');
        const satSlider = document.getElementById('adj-sat');
        const lightSlider = document.getElementById('adj-light');
        const hueVal = document.getElementById('adj-hue-val');
        const satVal = document.getElementById('adj-sat-val');
        const lightVal = document.getElementById('adj-light-val');
        const resetBtn = document.getElementById('adj-reset');

        let snapshotSaved = false;

        function onAdjust() {
            if (!snapshotSaved) {
                saveSnapshot();
                snapshotSaved = true;
            }
            const h = parseInt(hueSlider.value);
            const s = parseInt(satSlider.value);
            const l = parseInt(lightSlider.value);
            hueVal.textContent = h + '°';
            satVal.textContent = s + '%';
            lightVal.textContent = l + '%';
            applyHslAdjust(h, s, l);
            renderPreview();
        }

        hueSlider.addEventListener('input', onAdjust);
        satSlider.addEventListener('input', onAdjust);
        lightSlider.addEventListener('input', onAdjust);

        resetBtn.addEventListener('click', () => {
            hueSlider.value = 0;
            satSlider.value = 0;
            lightSlider.value = 0;
            snapshotSaved = false;
            captureOriginalColors(); // re-snapshot current state as new base
            onAdjust();
        });
    }

    function deleteLayer(idx) {
        const entry = flatLayers[idx];
        if (!entry) return;

        // Save snapshot before deletion
        saveSnapshot();

        const { layer, path } = entry;
        const layerName = layer.nm || `Layer ${idx}`;

        // Determine which layers array to splice from
        let layersArray;
        if (path[0] === 'asset') {
            // Layer inside an asset (precomp)
            const asset = lottieData.assets.find(a => a.id === path[1]);
            if (asset && asset.layers) {
                layersArray = asset.layers;
            }
        } else {
            layersArray = lottieData.layers;
        }

        if (!layersArray) return;

        const arrayIndex = layersArray.indexOf(layer);
        if (arrayIndex === -1) return;

        layersArray.splice(arrayIndex, 1);

        // Adjust selection
        if (selectedLayerIndex === idx) {
            selectedLayerIndex = null;
        } else if (selectedLayerIndex !== null && selectedLayerIndex > idx) {
            selectedLayerIndex--;
        }

        toast(`Deleted "${layerName}"`, 'info');
        renderPreview();
        buildLayersList();
        renderInspector();
    }

    // ═══════════════════════════════════════════
    // Global Color Palette
    // ═══════════════════════════════════════════

    function renderGlobalColorPalette() {
        // Collect colors from ALL layers
        const allColors = [];

        flatLayers.forEach((entry, idx) => {
            const layerColors = extractColors(entry.layer);
            layerColors.forEach(c => {
                allColors.push({
                    ...c,
                    layerName: entry.layer.nm || `Layer ${idx}`,
                    layerIndex: idx,
                });
            });
        });

        if (allColors.length === 0) {
            inspectorContent.innerHTML = `
                <div class="empty-state">
                    <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
                        <circle cx="24" cy="24" r="18" stroke="currentColor" stroke-width="2" opacity=".2"/>
                        <path d="M24 16v8M24 28v2" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" opacity=".3"/>
                    </svg>
                    <p>No editable colors<br>found in layers</p>
                </div>`;
            return;
        }

        // Group by hex value
        const colorGroups = new Map(); // hex -> { hex, entries: [{setter, layerName, label}] }
        allColors.forEach(c => {
            const hex = rgbToHex(c.color[0], c.color[1], c.color[2]);
            if (!colorGroups.has(hex)) {
                colorGroups.set(hex, { hex, entries: [] });
            }
            colorGroups.get(hex).entries.push(c);
        });

        const uniqueColors = Array.from(colorGroups.values());

        let html = `
            <div class="inspector-section">
                <div class="inspector-section-title">🎨 Colors — ${uniqueColors.length} unique / ${allColors.length} total</div>`;

        uniqueColors.forEach((group, gi) => {
            const count = group.entries.length;
            // Build tooltip with layer names
            const layerNames = [...new Set(group.entries.map(e => e.layerName))];
            const tooltipText = escHtml(layerNames.slice(0, 5).join(', ') + (layerNames.length > 5 ? ` +${layerNames.length - 5} more` : ''));

            html += `
                <div class="color-row" title="${tooltipText}">
                    <div class="color-swatch-wrapper">
                        <div class="color-swatch" style="background:${group.hex}"></div>
                        <input type="color" class="color-swatch-input" data-group-idx="${gi}" value="${group.hex}">
                    </div>
                    <span class="color-hex">${group.hex}</span>
                    <span class="color-count">${count}×</span>
                </div>`;
        });
        html += '</div>';

        inspectorContent.innerHTML = html;

        // Bind color input events — editing one hex changes ALL entries with that value
        inspectorContent.querySelectorAll('.color-swatch-input').forEach(inp => {
            let snapshotSaved = false;
            inp.addEventListener('input', (e) => {
                if (!snapshotSaved) {
                    saveSnapshot();
                    snapshotSaved = true;
                }
                const gi = parseInt(e.target.dataset.groupIdx);
                const group = uniqueColors[gi];
                if (!group) return;
                const rgb = hexToRgb(e.target.value);
                // Apply to ALL entries in this group
                group.entries.forEach(entry => entry.setter(rgb));
                // Update visuals
                const swatch = e.target.previousElementSibling;
                if (swatch) swatch.style.background = e.target.value;
                const hexLabel = e.target.closest('.color-row').querySelector('.color-hex');
                if (hexLabel) hexLabel.textContent = e.target.value;
                group.hex = e.target.value;
                renderPreview();
            });
            inp.addEventListener('change', () => { snapshotSaved = false; });
        });
    }

    // ═══════════════════════════════════════════
    // Inspector Panel
    // ═══════════════════════════════════════════

    function renderInspector() {
        // If we're not on inspector tab, redirect to the active tab
        if (currentTab !== 'inspector') {
            renderActiveTab();
            return;
        }

        if (selectedLayerIndex === null || !flatLayers[selectedLayerIndex]) {
            inspectorContent.innerHTML = `
                <div class="empty-state">
                    <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
                        <circle cx="24" cy="24" r="18" stroke="currentColor" stroke-width="2" opacity=".2"/>
                        <path d="M24 16v8M24 28v2" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" opacity=".3"/>
                    </svg>
                    <p>Select a layer<br>to inspect</p>
                </div>`;
            return;
        }

        const { layer } = flatLayers[selectedLayerIndex];
        let html = '';

        // ─── Layer Info ───
        html += `
            <div class="inspector-section">
                <div class="inspector-section-title">Layer Info</div>
                <div class="inspector-row">
                    <span class="inspector-label" style="min-width:auto;flex:1">Name</span>
                </div>
                <input type="text" class="inspector-input" id="inp-name" value="${escHtml(layer.nm || '')}" style="margin-bottom:8px">
                <div class="inspector-row">
                    <span class="inspector-label" style="min-width:50px">Type</span>
                    <span style="font-size:12px;color:var(--text-secondary)">${TYPE_NAMES[layer.ty] || 'Unknown'} (${layer.ty})</span>
                </div>
            </div>`;

        // ─── Drag hint ───
        const ks = layer.ks;
        if (ks && ks.p) {
            html += `
            <div class="inspector-section" style="margin-bottom:8px">
                <div style="font-size:11px;color:var(--text-muted);display:flex;align-items:center;gap:6px;padding:6px 8px;background:var(--bg-elevated);border-radius:var(--radius-sm)">
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1v12M1 7h12M7 1l-2 2M7 1l2 2M7 13l-2-2M7 13l2-2M1 7l2-2M1 7l2 2M13 7l-2-2M13 7l-2 2" stroke="currentColor" stroke-width="1" stroke-linecap="round"/></svg>
                    Drag on canvas to move
                </div>
            </div>`;
        }

        // ─── Position (Transform) ───
        if (ks && ks.p) {
            const pos = getStaticOrFirstKeyframe(ks.p);
            html += `
                <div class="inspector-section">
                    <div class="inspector-section-title">Position</div>
                    <div class="inspector-row">
                        <span class="inspector-label">X</span>
                        <input type="number" class="inspector-input" id="inp-pos-x" value="${pos[0] ?? 0}" step="1">
                    </div>
                    <div class="inspector-row">
                        <span class="inspector-label">Y</span>
                        <input type="number" class="inspector-input" id="inp-pos-y" value="${pos[1] ?? 0}" step="1">
                    </div>
                </div>`;
        }

        // ─── Anchor Point ───
        if (ks && ks.a) {
            const anchor = getStaticOrFirstKeyframe(ks.a);
            html += `
                <div class="inspector-section">
                    <div class="inspector-section-title">Anchor Point</div>
                    <div class="inspector-row">
                        <span class="inspector-label">X</span>
                        <input type="number" class="inspector-input" id="inp-anchor-x" value="${anchor[0] ?? 0}" step="1">
                    </div>
                    <div class="inspector-row">
                        <span class="inspector-label">Y</span>
                        <input type="number" class="inspector-input" id="inp-anchor-y" value="${anchor[1] ?? 0}" step="1">
                    </div>
                </div>`;
        }

        // ─── Scale ───
        if (ks && ks.s) {
            const scale = getStaticOrFirstKeyframe(ks.s);
            html += `
                <div class="inspector-section">
                    <div class="inspector-section-title">Scale (%)</div>
                    <div class="inspector-row">
                        <span class="inspector-label">X</span>
                        <input type="number" class="inspector-input" id="inp-scale-x" value="${scale[0] ?? 100}" step="1">
                    </div>
                    <div class="inspector-row">
                        <span class="inspector-label">Y</span>
                        <input type="number" class="inspector-input" id="inp-scale-y" value="${scale[1] ?? 100}" step="1">
                    </div>
                </div>`;
        }

        // ─── Opacity ───
        if (ks && ks.o) {
            const opacity = getStaticOrFirstKeyframeScalar(ks.o);
            html += `
                <div class="inspector-section">
                    <div class="inspector-section-title">Opacity</div>
                    <div class="inspector-row">
                        <span class="inspector-label">%</span>
                        <input type="number" class="inspector-input" id="inp-opacity" value="${opacity ?? 100}" min="0" max="100" step="1">
                    </div>
                </div>`;
        }

        // ─── Colors ───
        const colors = extractColors(layer);
        if (colors.length > 0) {
            html += `
                <div class="inspector-section">
                    <div class="inspector-section-title">Colors</div>`;
            colors.forEach((c, ci) => {
                const hex = rgbToHex(c.color[0], c.color[1], c.color[2]);
                html += `
                    <div class="color-row">
                        <div class="color-swatch-wrapper">
                            <div class="color-swatch" style="background:${hex}"></div>
                            <input type="color" class="color-swatch-input" data-color-index="${ci}" value="${hex}">
                        </div>
                        <span class="color-label">${c.label}</span>
                        <span class="color-hex">${hex}</span>
                    </div>`;
            });
            html += `</div>`;
        }

        inspectorContent.innerHTML = html;

        // ─── Bind Events ───

        // Name
        const inpName = document.getElementById('inp-name');
        if (inpName) {
            inpName.addEventListener('change', () => {
                saveSnapshot();
                layer.nm = inpName.value;
                buildLayersList();
            });
        }

        // Position
        const inpPosX = document.getElementById('inp-pos-x');
        const inpPosY = document.getElementById('inp-pos-y');
        if (inpPosX && inpPosY && ks && ks.p) {
            const handler = () => {
                saveSnapshot();
                setStaticOrFirstKeyframe(ks.p, [parseFloat(inpPosX.value) || 0, parseFloat(inpPosY.value) || 0]);
                renderPreview();
            };
            inpPosX.addEventListener('change', handler);
            inpPosY.addEventListener('change', handler);
        }

        // Anchor
        const inpAnchorX = document.getElementById('inp-anchor-x');
        const inpAnchorY = document.getElementById('inp-anchor-y');
        if (inpAnchorX && inpAnchorY && ks && ks.a) {
            const handler = () => {
                saveSnapshot();
                setStaticOrFirstKeyframe(ks.a, [parseFloat(inpAnchorX.value) || 0, parseFloat(inpAnchorY.value) || 0]);
                renderPreview();
            };
            inpAnchorX.addEventListener('change', handler);
            inpAnchorY.addEventListener('change', handler);
        }

        // Scale
        const inpScaleX = document.getElementById('inp-scale-x');
        const inpScaleY = document.getElementById('inp-scale-y');
        if (inpScaleX && inpScaleY && ks && ks.s) {
            const handler = () => {
                saveSnapshot();
                setStaticOrFirstKeyframe(ks.s, [parseFloat(inpScaleX.value) || 100, parseFloat(inpScaleY.value) || 100]);
                renderPreview();
            };
            inpScaleX.addEventListener('change', handler);
            inpScaleY.addEventListener('change', handler);
        }

        // Opacity
        const inpOpacity = document.getElementById('inp-opacity');
        if (inpOpacity && ks && ks.o) {
            inpOpacity.addEventListener('change', () => {
                saveSnapshot();
                setStaticOrFirstKeyframeScalar(ks.o, parseFloat(inpOpacity.value) || 100);
                renderPreview();
            });
        }

        // Colors
        inspectorContent.querySelectorAll('.color-swatch-input').forEach(inp => {
            let colorSnapshotSaved = false;
            inp.addEventListener('input', (e) => {
                if (!colorSnapshotSaved) {
                    saveSnapshot();
                    colorSnapshotSaved = true;
                }
                const ci = parseInt(e.target.dataset.colorIndex);
                const c = colors[ci];
                if (!c) return;
                const rgb = hexToRgb(e.target.value);
                c.setter(rgb);
                // Update swatch visual
                const swatch = e.target.previousElementSibling;
                if (swatch) swatch.style.background = e.target.value;
                // Update hex label
                const hexLabel = e.target.closest('.color-row').querySelector('.color-hex');
                if (hexLabel) hexLabel.textContent = e.target.value;
                renderPreview();
            });
            inp.addEventListener('change', () => {
                colorSnapshotSaved = false;
            });
        });
    }

    // ═══════════════════════════════════════════
    // Transform Helpers
    // ═══════════════════════════════════════════

    function getStaticOrFirstKeyframe(prop) {
        if (prop.a === 1 && prop.k && Array.isArray(prop.k) && prop.k.length > 0) {
            // Animated — return first keyframe value
            const kf = prop.k[0];
            return kf.s || kf.e || [0, 0];
        }
        // Static
        if (Array.isArray(prop.k)) return prop.k.slice();
        return [0, 0];
    }

    function setStaticOrFirstKeyframe(prop, values) {
        if (prop.a === 1 && prop.k && Array.isArray(prop.k) && prop.k.length > 0) {
            const kf = prop.k[0];
            if (kf.s) {
                kf.s[0] = values[0];
                kf.s[1] = values[1];
            }
        } else {
            if (Array.isArray(prop.k)) {
                prop.k[0] = values[0];
                prop.k[1] = values[1];
            }
        }
    }

    function getStaticOrFirstKeyframeScalar(prop) {
        if (prop.a === 1 && prop.k && Array.isArray(prop.k) && prop.k.length > 0) {
            const kf = prop.k[0];
            const val = kf.s || kf.e;
            return Array.isArray(val) ? val[0] : val;
        }
        if (Array.isArray(prop.k)) return prop.k[0];
        return prop.k;
    }

    function setStaticOrFirstKeyframeScalar(prop, value) {
        if (prop.a === 1 && prop.k && Array.isArray(prop.k) && prop.k.length > 0) {
            const kf = prop.k[0];
            if (kf.s) {
                if (Array.isArray(kf.s)) kf.s[0] = value;
                else kf.s = value;
            }
        } else {
            if (Array.isArray(prop.k)) prop.k[0] = value;
            else prop.k = value;
        }
    }

    // ═══════════════════════════════════════════
    // Color Extraction
    // ═══════════════════════════════════════════

    function extractColors(layer) {
        const colors = [];

        function walkShapes(shapes, prefix) {
            if (!shapes || !Array.isArray(shapes)) return;
            for (const shape of shapes) {
                // Group
                if (shape.ty === 'gr' && shape.it) {
                    walkShapes(shape.it, prefix + (shape.nm ? shape.nm + ' > ' : ''));
                }
                // Fill
                if (shape.ty === 'fl' && shape.c) {
                    const c = getColorValue(shape.c);
                    if (c) {
                        colors.push({
                            label: prefix + (shape.nm || 'Fill'),
                            color: c,
                            setter: (rgb) => setColorValue(shape.c, rgb),
                        });
                    }
                }
                // Stroke
                if (shape.ty === 'st' && shape.c) {
                    const c = getColorValue(shape.c);
                    if (c) {
                        colors.push({
                            label: prefix + (shape.nm || 'Stroke'),
                            color: c,
                            setter: (rgb) => setColorValue(shape.c, rgb),
                        });
                    }
                }
                // Gradient fill & gradient stroke — ALL color stops
                if ((shape.ty === 'gf' || shape.ty === 'gs') && shape.g && shape.g.k) {
                    const gType = shape.ty === 'gf' ? 'GFill' : 'GStroke';
                    const numStops = shape.g.p || 0;
                    extractGradientStops(shape.g.k, numStops, prefix + (shape.nm || gType), colors);
                }
            }
        }

        if (layer.shapes) {
            walkShapes(layer.shapes, '');
        }

        // Solid layer color
        if (layer.ty === 1 && layer.sc) {
            const rgb = hexToRgbNorm(layer.sc);
            if (rgb) {
                colors.push({
                    label: 'Solid Color',
                    color: rgb,
                    setter: (rgbVal) => {
                        layer.sc = rgbToHex(rgbVal[0], rgbVal[1], rgbVal[2]);
                    },
                });
            }
        }

        // Effects with color values
        if (layer.ef && Array.isArray(layer.ef)) {
            walkEffects(layer.ef, '', colors);
        }

        return colors;
    }

    function extractGradientStops(gk, numStops, labelPrefix, colors) {
        let data;
        if (gk.a === 1 && Array.isArray(gk.k) && gk.k.length > 0) {
            data = gk.k[0].s || gk.k[0].e || gk.k;
        } else {
            data = gk.k;
        }
        if (!Array.isArray(data)) return;
        const stopCount = numStops || Math.floor(data.length / 4);
        for (let i = 0; i < stopCount; i++) {
            const base = i * 4;
            if (base + 3 >= data.length) break;
            const stopIdx = i;
            colors.push({
                label: labelPrefix + ' #' + (i + 1),
                color: [data[base + 1], data[base + 2], data[base + 3]],
                setter: ((idx) => (rgb) => {
                    let arr;
                    if (gk.a === 1 && Array.isArray(gk.k) && gk.k.length > 0) {
                        arr = gk.k[0].s || gk.k[0].e || gk.k;
                    } else {
                        arr = gk.k;
                    }
                    const b = idx * 4;
                    arr[b + 1] = rgb[0]; arr[b + 2] = rgb[1]; arr[b + 3] = rgb[2];
                })(stopIdx),
            });
        }
    }

    function walkEffects(effects, prefix, colors) {
        for (const ef of effects) {
            const efName = prefix + (ef.nm || 'Effect') + ' > ';
            if (ef.v && ef.v.k) {
                const val = getColorValue(ef.v);
                if (val) {
                    colors.push({
                        label: efName + 'Color',
                        color: val,
                        setter: (rgb) => setColorValue(ef.v, rgb),
                    });
                }
            }
            if (ef.ef && Array.isArray(ef.ef)) {
                walkEffects(ef.ef, efName, colors);
            }
        }
    }

    function getColorValue(cProp) {
        if (!cProp) return null;
        let k;
        if (cProp.a === 1 && Array.isArray(cProp.k) && cProp.k.length > 0) {
            k = cProp.k[0].s || cProp.k[0].e;
        } else {
            k = cProp.k;
        }
        if (!Array.isArray(k) || k.length < 3) return null;
        return [k[0], k[1], k[2]];
    }

    function setColorValue(cProp, rgb) {
        if (!cProp) return;
        if (cProp.a === 1 && Array.isArray(cProp.k) && cProp.k.length > 0) {
            const kf = cProp.k[0];
            if (kf.s) { kf.s[0] = rgb[0]; kf.s[1] = rgb[1]; kf.s[2] = rgb[2]; }
            if (kf.e) { kf.e[0] = rgb[0]; kf.e[1] = rgb[1]; kf.e[2] = rgb[2]; }
            // Apply to all keyframes for simple color change
            for (const k of cProp.k) {
                if (k.s) { k.s[0] = rgb[0]; k.s[1] = rgb[1]; k.s[2] = rgb[2]; }
                if (k.e) { k.e[0] = rgb[0]; k.e[1] = rgb[1]; k.e[2] = rgb[2]; }
            }
        } else if (Array.isArray(cProp.k)) {
            cProp.k[0] = rgb[0];
            cProp.k[1] = rgb[1];
            cProp.k[2] = rgb[2];
        }
    }

    // ═══════════════════════════════════════════
    // Color Utilities
    // ═══════════════════════════════════════════

    function rgbToHex(r, g, b) {
        // Lottie uses 0-1 range
        const to255 = (v) => Math.round(Math.min(1, Math.max(0, v)) * 255);
        const hex = (v) => to255(v).toString(16).padStart(2, '0');
        return '#' + hex(r) + hex(g) + hex(b);
    }

    function hexToRgb(hex) {
        // returns 0-1 range
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        if (!result) return [0, 0, 0];
        return [
            parseInt(result[1], 16) / 255,
            parseInt(result[2], 16) / 255,
            parseInt(result[3], 16) / 255,
        ];
    }

    function hexToRgbNorm(hex) {
        return hexToRgb(hex);
    }

    // ═══════════════════════════════════════════
    // Export Dropdown
    // ═══════════════════════════════════════════

    const exportDropdown = document.getElementById('export-dropdown');
    const exportMenu     = document.getElementById('export-menu');

    btnExport.addEventListener('click', (e) => {
        if (!lottieData) return;
        e.stopPropagation();
        exportDropdown.classList.toggle('open');
    });

    document.addEventListener('click', (e) => {
        if (!exportDropdown.contains(e.target)) {
            exportDropdown.classList.remove('open');
        }
    });

    function getBaseName() {
        return (fileNameLabel.textContent || 'animation').replace(/\.json$/i, '');
    }

    function downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    }

    // ── Export JSON ──
    document.getElementById('export-json').addEventListener('click', () => {
        if (!lottieData) return;
        exportDropdown.classList.remove('open');
        const json = JSON.stringify(lottieData, null, 2);
        downloadBlob(new Blob([json], { type: 'application/json' }), getBaseName() + '_edited.json');
        toast('Exported JSON', 'success');
    });

    // ── Export TGS (gzipped Lottie for Telegram) ──
    document.getElementById('export-tgs').addEventListener('click', () => {
        if (!lottieData) return;
        exportDropdown.classList.remove('open');

        try {
            // TGS = gzipped JSON with specific constraints
            const json = JSON.stringify(lottieData);
            const compressed = pako.gzip(json);
            downloadBlob(new Blob([compressed], { type: 'application/gzip' }), getBaseName() + '.tgs');
            toast('Exported TGS', 'success');
        } catch (err) {
            toast('TGS export failed: ' + err.message, 'error');
        }
    });

    // ── Export SVG (current frame) ──
    // Uses the same approach as lottie-to-svg: captures rendered SVG from lottie-web
    document.getElementById('export-svg').addEventListener('click', () => {
        if (!lottieData || !anim) return;
        exportDropdown.classList.remove('open');

        try {
            // Pause at current frame to capture
            const wasPlaying = isPlaying;
            if (wasPlaying) anim.pause();

            const svgEl = lottiePlayer.querySelector('svg');
            if (!svgEl) {
                toast('No SVG found in player', 'error');
                return;
            }

            // Clone and clean up the SVG
            const clone = svgEl.cloneNode(true);
            clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
            clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');

            // Set explicit dimensions
            const w = lottieData.w || 512;
            const h = lottieData.h || 512;
            clone.setAttribute('width', w);
            clone.setAttribute('height', h);
            clone.setAttribute('viewBox', `0 0 ${w} ${h}`);

            const svgString = '<?xml version="1.0" encoding="UTF-8"?>\n' + clone.outerHTML;
            const frameNum = Math.floor(anim.currentFrame);
            downloadBlob(
                new Blob([svgString], { type: 'image/svg+xml' }),
                getBaseName() + `_frame${frameNum}.svg`
            );
            toast(`Exported SVG (frame ${frameNum})`, 'success');

            if (wasPlaying) anim.play();
        } catch (err) {
            toast('SVG export failed: ' + err.message, 'error');
        }
    });

    // ── Export PNG (current frame) ──
    document.getElementById('export-png').addEventListener('click', () => {
        if (!lottieData || !anim) return;
        exportDropdown.classList.remove('open');

        try {
            const wasPlaying = isPlaying;
            if (wasPlaying) anim.pause();

            const svgEl = lottiePlayer.querySelector('svg');
            if (!svgEl) {
                toast('No SVG found in player', 'error');
                return;
            }

            const w = lottieData.w || 512;
            const h = lottieData.h || 512;

            // Clone SVG with proper attributes
            const clone = svgEl.cloneNode(true);
            clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
            clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
            clone.setAttribute('width', w);
            clone.setAttribute('height', h);
            clone.setAttribute('viewBox', `0 0 ${w} ${h}`);

            const svgString = new XMLSerializer().serializeToString(clone);
            const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
            const svgUrl = URL.createObjectURL(svgBlob);

            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                // Use 2x for retina quality
                const scale = 2;
                canvas.width = w * scale;
                canvas.height = h * scale;
                const ctx = canvas.getContext('2d');
                ctx.scale(scale, scale);
                ctx.drawImage(img, 0, 0, w, h);
                URL.revokeObjectURL(svgUrl);

                canvas.toBlob((blob) => {
                    const frameNum = Math.floor(anim.currentFrame);
                    downloadBlob(blob, getBaseName() + `_frame${frameNum}.png`);
                    toast(`Exported PNG (frame ${frameNum}, ${w * scale}×${h * scale})`, 'success');
                    if (wasPlaying) anim.play();
                }, 'image/png');
            };
            img.onerror = () => {
                URL.revokeObjectURL(svgUrl);
                toast('PNG export failed: could not render SVG', 'error');
                if (wasPlaying) anim.play();
            };
            img.src = svgUrl;
        } catch (err) {
            toast('PNG export failed: ' + err.message, 'error');
        }
    });

    // ═══════════════════════════════════════════
    // Utility
    // ═══════════════════════════════════════════

    function escHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

})();
