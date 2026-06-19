// Minimal MRC/CCP4 (MRC2014) volume parser.
// Spec: https://www.ccpem.ac.uk/mrc_format/mrc2014.php
// The header is a fixed 1024 bytes, optionally followed by an extended header
// (NSYMBT bytes), then the density data itself.

export interface MrcVolume {
	nx: number;            // columns (fastest-changing axis)
	ny: number;            // rows
	nz: number;            // sections (slowest-changing axis)
	mode: number;          // data type code
	dmin: number;          // min density (from header)
	dmax: number;          // max density (from header)
	dmean: number;         // mean density (from header)
	cella: [number, number, number]; // cell dimensions in angstroms
	littleEndian: boolean;
	data: Float32Array;    // normalized to float32, length nx*ny*nz
}

// MRC data type codes we support.
const MODE_INT8 = 0;
const MODE_INT16 = 1;
const MODE_FLOAT32 = 2;
const MODE_UINT16 = 6;
const MODE_FLOAT16 = 12;

const HEADER_BYTES = 1024;

/** Decode an IEEE 754 half-precision (float16) value. */
function decodeFloat16(h: number): number {
	const sign = (h & 0x8000) >> 15;
	const exponent = (h & 0x7c00) >> 10;
	const fraction = h & 0x03ff;
	if (exponent === 0) {
		return (sign ? -1 : 1) * Math.pow(2, -14) * (fraction / 1024);
	} else if (exponent === 0x1f) {
		return fraction ? NaN : (sign ? -Infinity : Infinity);
	}
	return (sign ? -1 : 1) * Math.pow(2, exponent - 15) * (1 + fraction / 1024);
}

export function parseMrc(buffer: ArrayBuffer): MrcVolume {
	if (buffer.byteLength < HEADER_BYTES) {
		throw new Error(`File too small to be an MRC volume (${buffer.byteLength} bytes).`);
	}
	const view = new DataView(buffer);

	// Determine endianness. The machine stamp lives at byte 212: 0x44,0x44 for
	// little-endian, 0x11,0x11 for big-endian. Some files omit it, so we also
	// sanity-check the parsed dimensions and fall back to the opposite order.
	let littleEndian = view.getUint8(212) === 0x44;
	const looksValid = (le: boolean) => {
		const nx = view.getInt32(0, le);
		const ny = view.getInt32(4, le);
		const nz = view.getInt32(8, le);
		const mode = view.getInt32(12, le);
		return nx > 0 && ny > 0 && nz > 0 && nx < 1e5 && ny < 1e5 && nz < 1e5 &&
			[0, 1, 2, 3, 4, 6, 12].includes(mode);
	};
	if (!looksValid(littleEndian)) {
		littleEndian = !littleEndian;
		if (!looksValid(littleEndian)) {
			throw new Error('Could not parse MRC header (dimensions/mode look invalid).');
		}
	}

	const nx = view.getInt32(0, littleEndian);
	const ny = view.getInt32(4, littleEndian);
	const nz = view.getInt32(8, littleEndian);
	const mode = view.getInt32(12, littleEndian);
	const cellaX = view.getFloat32(40, littleEndian);
	const cellaY = view.getFloat32(44, littleEndian);
	const cellaZ = view.getFloat32(48, littleEndian);
	const dmin = view.getFloat32(76, littleEndian);
	const dmax = view.getFloat32(80, littleEndian);
	const dmean = view.getFloat32(84, littleEndian);
	const nsymbt = view.getInt32(92, littleEndian); // extended header size

	const count = nx * ny * nz;
	const dataOffset = HEADER_BYTES + nsymbt;
	const data = new Float32Array(count);

	switch (mode) {
		case MODE_INT8: {
			for (let i = 0; i < count; i++) {
				data[i] = view.getInt8(dataOffset + i);
			}
			break;
		}
		case MODE_INT16: {
			for (let i = 0; i < count; i++) {
				data[i] = view.getInt16(dataOffset + i * 2, littleEndian);
			}
			break;
		}
		case MODE_UINT16: {
			for (let i = 0; i < count; i++) {
				data[i] = view.getUint16(dataOffset + i * 2, littleEndian);
			}
			break;
		}
		case MODE_FLOAT16: {
			for (let i = 0; i < count; i++) {
				data[i] = decodeFloat16(view.getUint16(dataOffset + i * 2, littleEndian));
			}
			break;
		}
		case MODE_FLOAT32: {
			for (let i = 0; i < count; i++) {
				data[i] = view.getFloat32(dataOffset + i * 4, littleEndian);
			}
			break;
		}
		default:
			throw new Error(`Unsupported MRC mode ${mode} (complex types not yet handled).`);
	}

	return {
		nx, ny, nz, mode, dmin, dmax, dmean,
		cella: [cellaX, cellaY, cellaZ],
		littleEndian,
		data,
	};
}
