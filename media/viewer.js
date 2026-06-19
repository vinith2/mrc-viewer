// @ts-check
// Webview front-end for the MRC orthoview slice viewer. Shows three linked
// panes (XY / XZ / YZ), each scrubbable along its own axis, with a shared
// crosshair so clicking one pane repositions the other two.
(function () {
	const vscode = acquireVsCodeApi();

	/** @type {{nx:number,ny:number,nz:number,mode:number,dmin:number,dmax:number,dmean:number,cella:number[],data:Float32Array}|null} */
	let vol = null;
	let invert = false;
	// Current voxel position shared across panes.
	const pos = { x: 0, y: 0, z: 0 };

	const statusEl = document.getElementById('status');
	const appEl = document.getElementById('app');
	const mipEl = /** @type {HTMLInputElement} */ (document.getElementById('mip'));
	const levelEl = /** @type {HTMLInputElement} */ (document.getElementById('level'));
	const windowEl = /** @type {HTMLInputElement} */ (document.getElementById('window'));
	const autoBtn = document.getElementById('auto');
	const invertBtn = document.getElementById('invert');
	const infoEl = document.getElementById('info');

	const MODE_NAMES = { 0: 'int8', 1: 'int16', 2: 'float32', 6: 'uint16', 12: 'float16' };

	// Per-axis pane wiring. Each pane fixes one axis and plots the other two.
	const PANES = {
		z: {
			canvas: /** @type {HTMLCanvasElement} */ (document.getElementById('canZ')),
			slider: /** @type {HTMLInputElement} */ (document.getElementById('sliceZ')),
			label: document.getElementById('lblZ'),
		},
		y: {
			canvas: /** @type {HTMLCanvasElement} */ (document.getElementById('canY')),
			slider: /** @type {HTMLInputElement} */ (document.getElementById('sliceY')),
			label: document.getElementById('lblY'),
		},
		x: {
			canvas: /** @type {HTMLCanvasElement} */ (document.getElementById('canX')),
			slider: /** @type {HTMLInputElement} */ (document.getElementById('sliceX')),
			label: document.getElementById('lblX'),
		},
	};

	window.addEventListener('message', (e) => {
		const msg = e.data;
		if (msg.type === 'error') {
			statusEl.textContent = 'Error: ' + msg.message;
			return;
		}
		if (msg.type === 'volume') {
			vol = {
				nx: msg.nx, ny: msg.ny, nz: msg.nz,
				mode: msg.mode, dmin: msg.dmin, dmax: msg.dmax, dmean: msg.dmean,
				cella: msg.cella,
				data: new Float32Array(msg.data),
			};
			onVolumeLoaded();
		}
	});

	function onVolumeLoaded() {
		statusEl.hidden = true;
		appEl.hidden = false;
		pos.x = Math.floor(vol.nx / 2);
		pos.y = Math.floor(vol.ny / 2);
		pos.z = Math.floor(vol.nz / 2);
		setupSlider('z', vol.nz);
		setupSlider('y', vol.ny);
		setupSlider('x', vol.nx);
		autoContrast();
		renderAll();
		showInfo();
	}

	function setupSlider(axis, n) {
		const p = PANES[axis];
		p.slider.max = String(n - 1);
		p.slider.value = String(pos[axis]);
		p.label.textContent = String(pos[axis]);
		p.slider.addEventListener('input', () => {
			pos[axis] = Number(p.slider.value);
			p.label.textContent = p.slider.value;
			renderAll();
		});
		p.canvas.addEventListener('click', (ev) => onPaneClick(axis, ev));
	}

	// ---- contrast (window / level) ----
	function levelValue() {
		const lo = vol.dmin, hi = vol.dmax;
		return lo + (hi - lo) * (Number(levelEl.value) / 1000);
	}
	function windowValue() {
		const range = vol.dmax - vol.dmin || 1;
		return range * (Number(windowEl.value) / 1000);
	}
	function autoContrast() {
		const range = vol.dmax - vol.dmin || 1;
		levelEl.value = String(Math.round(((vol.dmean - vol.dmin) / range) * 1000));
		windowEl.value = '1000';
	}

	/** Voxel accessor using the volume's storage order. */
	function voxel(x, y, z) {
		return vol.data[z * vol.nx * vol.ny + y * vol.nx + x];
	}

	// For a given pane axis, return the 2D plane dimensions and a sampler.
	// Returns also the crosshair position (in plane coords) and axis captions.
	function planeFor(axis, mip) {
		if (axis === 'z') {
			const idx = pos.z;
			return {
				w: vol.nx, h: vol.ny,
				get: mip
					? (i, j) => { let m = -Infinity; for (let z = 0; z < vol.nz; z++) { const v = voxel(i, j, z); if (v > m) m = v; } return m; }
					: (i, j) => voxel(i, j, idx),
				cross: { i: pos.x, j: pos.y },
			};
		}
		if (axis === 'y') {
			const idx = pos.y;
			return {
				w: vol.nx, h: vol.nz,
				get: mip
					? (i, j) => { let m = -Infinity; for (let y = 0; y < vol.ny; y++) { const v = voxel(i, y, j); if (v > m) m = v; } return m; }
					: (i, j) => voxel(i, idx, j),
				cross: { i: pos.x, j: pos.z },
			};
		}
		// x
		const idx = pos.x;
		return {
			w: vol.ny, h: vol.nz,
			get: mip
				? (i, j) => { let m = -Infinity; for (let x = 0; x < vol.nx; x++) { const v = voxel(x, i, j); if (v > m) m = v; } return m; }
				: (i, j) => voxel(idx, i, j),
			cross: { i: pos.y, j: pos.z },
		};
	}

	function renderPane(axis) {
		const p = PANES[axis];
		const ctx = p.canvas.getContext('2d');
		const mip = mipEl.checked;
		const { w, h, get, cross } = planeFor(axis, mip);
		const level = levelValue();
		const win = windowValue() || 1;
		const lo = level - win / 2;

		const img = ctx.createImageData(w, h);
		const px = img.data;
		for (let j = 0; j < h; j++) {
			for (let i = 0; i < w; i++) {
				let t = (get(i, j) - lo) / win;
				t = t < 0 ? 0 : t > 1 ? 1 : t;
				let g = Math.round(t * 255);
				if (invert) { g = 255 - g; }
				// Flip vertically so row 0 sits at the bottom (image convention).
				const o = ((h - 1 - j) * w + i) * 4;
				px[o] = px[o + 1] = px[o + 2] = g;
				px[o + 3] = 255;
			}
		}
		p.canvas.width = w;
		p.canvas.height = h;
		ctx.putImageData(img, 0, 0);

		// Crosshair showing where the other two slices intersect this plane.
		if (!mip) {
			const cy = h - 1 - cross.j; // account for the vertical flip
			ctx.strokeStyle = 'rgba(80,180,255,0.7)';
			ctx.lineWidth = 1;
			ctx.beginPath();
			ctx.moveTo(cross.i + 0.5, 0);
			ctx.lineTo(cross.i + 0.5, h);
			ctx.moveTo(0, cy + 0.5);
			ctx.lineTo(w, cy + 0.5);
			ctx.stroke();
		}
	}

	function renderAll() {
		if (!vol) { return; }
		renderPane('z');
		renderPane('y');
		renderPane('x');
	}

	// Click on a pane -> move the crosshair, updating the two perpendicular axes.
	function onPaneClick(axis, ev) {
		const p = PANES[axis];
		const rect = p.canvas.getBoundingClientRect();
		const i = Math.floor(((ev.clientX - rect.left) / rect.width) * p.canvas.width);
		const jTop = Math.floor(((ev.clientY - rect.top) / rect.height) * p.canvas.height);
		const j = p.canvas.height - 1 - jTop; // undo vertical flip
		if (axis === 'z') { pos.x = clamp(i, vol.nx); pos.y = clamp(j, vol.ny); }
		else if (axis === 'y') { pos.x = clamp(i, vol.nx); pos.z = clamp(j, vol.nz); }
		else { pos.y = clamp(i, vol.ny); pos.z = clamp(j, vol.nz); }
		syncSliders();
		renderAll();
	}

	function clamp(v, n) { return v < 0 ? 0 : v >= n ? n - 1 : v; }

	function syncSliders() {
		for (const axis of ['x', 'y', 'z']) {
			PANES[axis].slider.value = String(pos[axis]);
			PANES[axis].label.textContent = String(pos[axis]);
		}
	}

	function showInfo() {
		const [cx, cy, cz] = vol.cella;
		const apX = (cx / vol.nx) || 0;
		infoEl.innerHTML =
			`<b>${vol.nx} × ${vol.ny} × ${vol.nz}</b> voxels<br>` +
			`mode ${MODE_NAMES[vol.mode] || vol.mode}<br>` +
			`density [${fmt(vol.dmin)}, ${fmt(vol.dmax)}]<br>mean ${fmt(vol.dmean)}<br>` +
			`cell ${fmt(cx)}×${fmt(cy)}×${fmt(cz)} Å<br>${fmt(apX)} Å/voxel`;
	}

	function fmt(n) {
		if (!isFinite(n)) { return '—'; }
		return Math.abs(n) >= 1000 || (Math.abs(n) < 0.01 && n !== 0)
			? n.toExponential(2) : n.toFixed(2);
	}

	mipEl.addEventListener('change', renderAll);
	levelEl.addEventListener('input', renderAll);
	windowEl.addEventListener('input', renderAll);
	autoBtn.addEventListener('click', () => { autoContrast(); renderAll(); });
	invertBtn.addEventListener('click', () => { invert = !invert; renderAll(); });

	// ---- 3D isosurface tab (Mol*, minimal ChimeraX-style controls) ----
	const tabSlices = document.getElementById('tabSlices');
	const tab3d = document.getElementById('tab3d');
	const sliceView = document.getElementById('sliceView');
	const isoView = document.getElementById('isoView');
	const isoStatus = document.getElementById('isoStatus');
	const level3d = /** @type {HTMLInputElement} */ (document.getElementById('level3d'));
	const level3dVal = document.getElementById('level3dVal');
	const opacity3d = /** @type {HTMLInputElement} */ (document.getElementById('opacity3d'));
	const opacity3dVal = document.getElementById('opacity3dVal');
	const color3d = /** @type {HTMLInputElement} */ (document.getElementById('color3d'));
	const reset3dBtn = document.getElementById('reset3d');

	let molViewer = null;     // the Mol* Viewer instance
	let molPlugin = null;     // viewer.plugin (PluginContext)
	let reprRef = null;       // state ref of the VolumeRepresentation3D node
	let volStats = null;      // { min, max, mean, sigma } from the loaded volume
	let molInitStarted = false;
	let rawFileBuffer = null; // ArrayBuffer of the original file
	let pendingRawRequest = false;
	let applyTimer = null;

	async function ensureMolstar() {
		if (molInitStarted) { return; }
		molInitStarted = true;
		if (!window.molstar) {
			isoStatus.textContent = 'Mol* failed to load.';
			return;
		}
		try {
			// Hide all of Mol*'s built-in UI — we drive it with our own controls.
			molViewer = await window.molstar.Viewer.create('molstar', {
				layoutIsExpanded: false,
				layoutShowControls: false,
				layoutShowRemoteState: false,
				layoutShowSequence: false,
				layoutShowLog: false,
				layoutShowLeftPanel: false,
				collapseLeftPanel: true,
				viewportShowExpand: false,
				viewportShowControls: false,
				viewportShowSettings: false,
				viewportShowSelectionMode: false,
				viewportShowAnimation: false,
				viewportShowTrajectoryControls: false,
				viewportShowScreenshotControls: false,
			});
			molPlugin = molViewer.plugin;
			if (rawFileBuffer) {
				loadVolumeIntoMolstar();
			} else if (!pendingRawRequest) {
				pendingRawRequest = true;
				vscode.postMessage({ type: 'requestRaw' });
			}
		} catch (err) {
			isoStatus.textContent = 'Mol* init error: ' + (err && err.message ? err.message : err);
		}
	}

	async function loadVolumeIntoMolstar() {
		if (!molViewer || !rawFileBuffer) { return; }
		try {
			isoStatus.hidden = false;
			isoStatus.textContent = 'Loading volume into Mol*…';
			// Mol* loads from a URL; wrap the bytes in a blob URL it can fetch.
			const blob = new Blob([rawFileBuffer]);
			const url = URL.createObjectURL(blob);
			await molViewer.loadVolumeFromUrl(
				{ url, format: 'ccp4', isBinary: true },
				[{ type: 'relative', value: 1, color: hexToInt(color3d.value), alpha: 1 }],
			);
			URL.revokeObjectURL(url);
			grabReprAndStats();
			setupControls();
			isoStatus.hidden = true;
		} catch (err) {
			isoStatus.hidden = false;
			isoStatus.textContent = 'Volume load error: ' + (err && err.message ? err.message : err);
		}
	}

	// Locate the representation node and the volume's statistics in the state.
	function grabReprAndStats() {
		const T = window.molstar.lib.plugin.StateTransforms.Representation.VolumeRepresentation3D;
		molPlugin.state.data.cells.forEach((cell, ref) => {
			if (cell.transform.transformer === T) { reprRef = ref; }
			const st = cell.obj && cell.obj.data && cell.obj.data.grid && cell.obj.data.grid.stats;
			if (st) { volStats = st; }
		});
	}

	function setupControls() {
		if (!volStats) { return; }
		const { min, max, mean, sigma } = volStats;
		level3d.min = String(min);
		level3d.max = String(max);
		level3d.step = String((max - min) / 1000 || 0.0001);
		// Default contour: 1 sigma above the mean (Mol*'s "relative 1").
		const start = Math.min(max, mean + sigma);
		level3d.value = String(start);
		level3d.disabled = false;
		opacity3d.disabled = false;
		level3dVal.textContent = fmt(start);
		applyContour();
	}

	async function applyContour() {
		if (!reprRef || !molPlugin) { return; }
		const Volume = window.molstar.lib.volume.Volume;
		const level = Number(level3d.value);
		const alpha = Number(opacity3d.value);
		const color = hexToInt(color3d.value);
		try {
			await molPlugin.state.data.build().to(reprRef).update((old) => {
				old.type.params.isoValue = Volume.IsoValue.absolute(level);
				old.type.params.alpha = alpha;
				if (old.colorTheme && old.colorTheme.params) {
					old.colorTheme.params.value = color;
				}
			}).commit();
		} catch (err) {
			isoStatus.hidden = false;
			isoStatus.textContent = 'Update error: ' + (err && err.message ? err.message : err);
		}
	}

	function scheduleApply() {
		clearTimeout(applyTimer);
		applyTimer = setTimeout(applyContour, 80);
	}

	function hexToInt(hex) { return parseInt(hex.replace('#', ''), 16); }

	level3d.addEventListener('input', () => { level3dVal.textContent = fmt(Number(level3d.value)); scheduleApply(); });
	opacity3d.addEventListener('input', () => { opacity3dVal.textContent = Number(opacity3d.value).toFixed(2); scheduleApply(); });
	color3d.addEventListener('input', scheduleApply);
	reset3dBtn.addEventListener('click', () => {
		if (molPlugin && molPlugin.canvas3d) { molPlugin.canvas3d.requestCameraReset(); }
	});

	function showTab(which) {
		const is3d = which === '3d';
		tab3d.classList.toggle('active', is3d);
		tabSlices.classList.toggle('active', !is3d);
		sliceView.hidden = is3d;
		isoView.hidden = !is3d;
		if (is3d) { ensureMolstar(); }
	}

	tabSlices.addEventListener('click', () => showTab('slices'));
	tab3d.addEventListener('click', () => showTab('3d'));

	// Raw bytes arrive separately (only fetched when 3D is first opened).
	window.addEventListener('message', (e) => {
		if (e.data && e.data.type === 'rawFile') {
			rawFileBuffer = e.data.data;
			loadVolumeIntoMolstar();
		}
	});

	vscode.postMessage({ type: 'ready' });
}());
