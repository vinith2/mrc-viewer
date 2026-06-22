import * as vscode from 'vscode';
import { parseMrc } from './mrc';

/**
 * Read-only custom editor for `.mrc` cryo-EM volume files.
 * The volume is parsed in the extension host and the normalized float data is
 * shipped to a webview that renders interactive orthogonal slices.
 */
export class MrcEditorProvider implements vscode.CustomReadonlyEditorProvider {
	public static readonly viewType = 'mrc-viewer.volume';

	constructor(private readonly context: vscode.ExtensionContext) {}

	public static register(context: vscode.ExtensionContext): vscode.Disposable {
		return vscode.window.registerCustomEditorProvider(
			MrcEditorProvider.viewType,
			new MrcEditorProvider(context),
			{
				supportsMultipleEditorsPerDocument: false,
				webviewOptions: { retainContextWhenHidden: true },
			},
		);
	}

	// A read-only document needs no model beyond its URI.
	openCustomDocument(uri: vscode.Uri): vscode.CustomDocument {
		return { uri, dispose: () => {} };
	}

	async resolveCustomEditor(
		document: vscode.CustomDocument,
		webviewPanel: vscode.WebviewPanel,
	): Promise<void> {
		const webview = webviewPanel.webview;
		webview.options = {
			enableScripts: true,
			localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')],
		};
		webview.html = this.getHtml(webview);

		// Read the file once and cache the raw bytes. The webview asks for the
		// parsed volume (slice viewer) on 'ready', and the raw file bytes
		// (handed to Mol*) the first time the 3D tab is opened.
		let rawBuffer: ArrayBuffer | undefined;
		const loadBuffer = async (): Promise<ArrayBuffer> => {
			if (!rawBuffer) {
				const bytes = await vscode.workspace.fs.readFile(document.uri);
				// Copy into a tight, plain ArrayBuffer (the read buffer may be a
				// view into a pool, or a SharedArrayBuffer).
				const copy = new Uint8Array(bytes.byteLength);
				copy.set(bytes);
				rawBuffer = copy.buffer;
			}
			return rawBuffer;
		};

		webview.onDidReceiveMessage(async (msg) => {
			try {
				if (msg?.type === 'ready') {
					const buf = await loadBuffer();
					const vol = parseMrc(buf.slice(0));
					webview.postMessage({
						type: 'volume',
						nx: vol.nx, ny: vol.ny, nz: vol.nz,
						mode: vol.mode,
						dmin: vol.dmin, dmax: vol.dmax, dmean: vol.dmean,
						cella: vol.cella,
						data: vol.data.buffer,
					});
				} else if (msg?.type === 'requestRaw') {
					const buf = await loadBuffer();
					webview.postMessage({ type: 'rawFile', data: buf.slice(0) });
				}
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				webview.postMessage({ type: 'error', message });
			}
		});
	}

	private getHtml(webview: vscode.Webview): string {
		const mediaUri = (file: string) =>
			webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', file));
		const scriptUri = mediaUri('viewer.js');
		const molstarJs = mediaUri('molstar/molstar.js');
		const molstarCss = mediaUri('molstar/molstar.css');
		const styleUri = mediaUri('viewer.css');
		const nonce = getNonce();

		// Mol* needs: blob-backed Web Workers, WASM, inline styles it injects,
		// and fetch of the blob: URL we build from the file bytes.
		const csp = [
			`default-src 'none'`,
			`img-src ${webview.cspSource} blob: data:`,
			`style-src ${webview.cspSource} 'unsafe-inline'`,
			`font-src ${webview.cspSource} data:`,
			`script-src 'nonce-${nonce}' 'wasm-unsafe-eval' 'unsafe-eval' blob:`,
			`worker-src blob:`,
			`child-src blob:`,
			`connect-src blob: data:`,
		].join('; ');

		return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="${csp};">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<link href="${molstarCss}" rel="stylesheet">
	<link href="${styleUri}" rel="stylesheet">
	<title>MRC Viewer</title>
</head>
<body>
	<div id="status">Loading volume…</div>
	<div id="app" hidden>
		<div id="tabs">
			<button id="tabSlices" class="tab active">Slices</button>
			<button id="tab3d" class="tab">3D Isosurface</button>
		</div>
		<div id="sliceView">
		<div id="controls">
			<div class="row">
				<label><input type="checkbox" id="mip"> Max projection</label>
				<label>Level</label>
				<input type="range" id="level" min="0" max="1000" value="500">
				<label>Window</label>
				<input type="range" id="window" min="1" max="1000" value="1000">
				<button id="auto">Auto</button>
				<button id="invert">Invert</button>
				<button id="resetZoom">Reset zoom</button>
			</div>
		</div>
		<div id="grid">
			<div class="pane" data-axis="z">
				<div class="pane-head">XY (axial) &nbsp; Z = <span id="lblZ">0</span></div>
				<div class="canvas-wrap"><canvas id="canZ"></canvas></div>
				<input type="range" id="sliceZ" min="0" max="0" value="0">
			</div>
			<div class="pane" data-axis="y">
				<div class="pane-head">XZ (coronal) &nbsp; Y = <span id="lblY">0</span></div>
				<div class="canvas-wrap"><canvas id="canY"></canvas></div>
				<input type="range" id="sliceY" min="0" max="0" value="0">
			</div>
			<div class="pane" data-axis="x">
				<div class="pane-head">YZ (sagittal) &nbsp; X = <span id="lblX">0</span></div>
				<div class="canvas-wrap"><canvas id="canX"></canvas></div>
				<input type="range" id="sliceX" min="0" max="0" value="0">
			</div>
			<div id="info" class="pane"></div>
		</div>
		</div>
		<div id="isoView" hidden>
			<div id="isoControls">
				<div class="row">
					<label>Surface level</label>
					<input type="range" id="level3d" min="0" max="1" step="0.0001" value="0.5" disabled>
					<span id="level3dVal" class="muted">—</span>
				</div>
				<div class="row">
					<label>Opacity</label>
					<input type="range" id="opacity3d" min="0" max="1" step="0.01" value="1" disabled>
					<span id="opacity3dVal" class="muted">1.00</span>
					<input type="color" id="color3d" value="#3377aa" title="Surface color">
					<button id="reset3d" title="Recenter the view">Reset view</button>
				</div>
				<div id="isoStatus" class="muted">Initializing Mol*…</div>
			</div>
			<div id="molstar"></div>
		</div>
	</div>
	<script nonce="${nonce}" src="${molstarJs}"></script>
	<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
	}
}

function getNonce(): string {
	let text = '';
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return text;
}
