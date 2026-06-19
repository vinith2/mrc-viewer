# mrc-viewer

A VS Code extension for viewing **MRC / CCP4 cryo-EM volume maps** directly from your workspace.
Open a `.mrc`, `.map`, `.mrcs`, or `.ccp4` file and it renders in a custom editor with both 2D slice navigation and an interactive 3D isosurface (powered by [Mol*](https://molstar.org/)), similar to the EMDB [3D view](https://www.ebi.ac.uk/emdb/).

It's meant as a **minimal, drop-in replacement for ChimeraX and IMOD (`3dmod`) for quick checks** — eyeball a map, scrub through slices, or check a contour level right inside your editor, without launching the full desktop tools. It is *not* a replacement for their full analysis, segmentation, or model-building features.

## Demo

![mrc-viewer demo](https://raw.githubusercontent.com/vinith2/mrc-viewer/main/images/demo.gif)

> The clip above is sped up. For the full-quality recording, [watch the MP4](https://github.com/vinith2/mrc-viewer/raw/main/images/demo.mp4).

## Installation

The extension is distributed as a `.vsix` file. To install it in VS Code:

1. Download the latest `mrc-viewer-<version>.vsix` from the [Releases page](https://github.com/vinith2/mrc-viewer/releases).
2. In VS Code, open the **Extensions** view (`Cmd+Shift+X` / `Ctrl+Shift+X`).
3. Click the **`···`** menu at the top of the Extensions panel → **Install from VSIX…**
4. Select the downloaded `.vsix` file.
5. Reload VS Code if prompted.

Or, from a terminal:

```bash
code --install-extension mrc-viewer-<version>.vsix
```

Once installed, just open any `.mrc`, `.map`, `.mrcs`, or `.ccp4` file from the Explorer — it opens in the viewer automatically.

## Features

Opening a supported file shows a viewer with two tabs:

### Slices
A linked orthogonal slice view (XY / XZ / YZ), like a medical-imaging orthoview:

- A slider per axis to scrub through Z, Y, and X.
- A **crosshair** linking the three panes — click anywhere in one pane and the other two recenter on that point.
- **Window / Level** contrast controls, **Auto** contrast, and **Invert**.
- **Max projection** (MIP) toggle per axis.
- A readout of volume dimensions, data mode, density range, and cell size (Å/voxel).

### 3D Isosurface
A GPU-rendered isosurface via Mol\*, with a minimal, ChimeraX-style control set:

- **Surface level** — slider across the map's density range (defaults to ~1σ above the mean).
- **Opacity**.
- **Surface color**.
- **Reset view**, plus mouse orbit / zoom / pan.

## Supported formats

MRC2014 / CCP4 maps with extensions `.mrc`, `.mrcs`, `.map`, `.ccp4`. Data modes 0 (int8), 1 (int16), 2 (float32), 6 (uint16), and 12 (float16) are supported; endianness is auto-detected. (Complex modes 3/4 are not handled.)

## Requirements

None beyond VS Code `^1.125.0`. Mol\* is bundled with the extension — nothing to install and no network access required.

## Development

```bash
npm install
npm run compile      # or: npm run watch
```

Press **F5** to launch an Extension Development Host, then open a `.mrc`/`.map` file from the Explorer.

```bash
npm test             # run the extension test suite
npm run lint
```

## How it works

- The MRC binary is parsed in the extension host ([src/mrc.ts](src/mrc.ts)) and rendered as 2D slices on a canvas ([media/viewer.js](media/viewer.js)).
- The 3D tab hands the raw file bytes to a bundled Mol\* viewer ([media/molstar/](media/molstar/)) and drives its volume isosurface representation directly, exposing only the surface level / opacity / color controls.

## Known limitations

- Complex-valued MRC modes (3, 4) are not supported.
- Very large maps are rendered at full resolution (no data subsampling / "step" control yet); extremely large volumes may be slow to re-contour.
- The 3D view requires `'unsafe-eval'` in the webview Content Security Policy, which Mol*'s prebuilt bundle needs. This is scoped to the viewer webview, which only ever loads the bundled local assets and the opened file.

## Release Notes

### 0.0.1

Initial release: MRC/CCP4 custom editor with linked 2D orthoview slices and a Mol\*-powered 3D isosurface.
