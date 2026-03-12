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
        if (file && file.name.endsWith('.json')) {
            loadFile(file);
        } else {
            toast('Please drop a .json Lottie file', 'error');
        }
    });

    function loadFile(file) {
        const reader = new FileReader();
        reader.onload = (ev) => {
            try {
                lottieData = JSON.parse(ev.target.result);
                if (!lottieData.layers || !Array.isArray(lottieData.layers)) {
                    throw new Error('Invalid Lottie: no layers array');
                }
                fileNameLabel.textContent = file.name;
                btnExport.disabled = false;
                selectedLayerIndex = null;
                undoStack.length = 0; // reset undo for new file
                toast(`Loaded "${file.name}"`, 'success');
                renderPreview();
                buildLayersList();
                renderInspector();
            } catch (err) {
                toast('Failed to parse JSON: ' + err.message, 'error');
            }
        };
        reader.readAsText(file);
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

        anim = lottie.loadAnimation({
            container: lottiePlayer,
            renderer: 'svg',
            loop: isLooping,
            autoplay: true,
            animationData: JSON.parse(JSON.stringify(lottieData)), // deep clone
        });

        isPlaying = true;
        updatePlayPauseIcon();

        const totalFrames = anim.totalFrames;
        scrubber.max = Math.floor(totalFrames);

        anim.addEventListener('enterFrame', () => {
            const cf = Math.floor(anim.currentFrame);
            scrubber.value = cf;
            frameLabel.textContent = `${cf} / ${Math.floor(totalFrames)}`;
        });
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

        anim = lottie.loadAnimation({
            container: lottiePlayer,
            renderer: 'svg',
            loop: isLooping,
            autoplay: false,
            animationData: JSON.parse(JSON.stringify(lottieData)),
        });

        anim.goToAndStop(currentFrame, true);

        const totalFrames = anim.totalFrames;
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
        selectedLayerIndex = idx;
        // Update selection visuals
        layersList.querySelectorAll('.layer-item').forEach((el, i) => {
            el.classList.toggle('selected', i === idx);
        });
        renderInspector();
        // Change cursor to grab when a layer is selected
        if (flatLayers[idx] && flatLayers[idx].layer.ks && flatLayers[idx].layer.ks.p) {
            lottiePlayer.style.cursor = 'grab';
        } else {
            lottiePlayer.style.cursor = '';
        }
    }

    // ═══════════════════════════════════════════
    // Delete Layer
    // ═══════════════════════════════════════════

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
    // Inspector Panel
    // ═══════════════════════════════════════════

    function renderInspector() {
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
                    walkShapes(shape.it, prefix + (shape.nm ? shape.nm + ' → ' : ''));
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
                // Gradient fill
                if (shape.ty === 'gf' && shape.g && shape.g.k) {
                    const gk = shape.g.k;
                    const data = gk.a === 1 ? (gk.k[0]?.s || gk.k) : gk.k;
                    if (Array.isArray(data) && data.length >= 4) {
                        colors.push({
                            label: prefix + (shape.nm || 'Gradient') + ' (stop 1)',
                            color: [data[1], data[2], data[3]],
                            setter: (rgb) => {
                                const arr = gk.a === 1 ? (gk.k[0]?.s || gk.k) : gk.k;
                                arr[1] = rgb[0]; arr[2] = rgb[1]; arr[3] = rgb[2];
                            },
                        });
                    }
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

        return colors;
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
