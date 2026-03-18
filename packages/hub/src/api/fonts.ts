import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, extname, join } from "node:path";
import type { FontFamily, FontFile } from "@nexterm/shared";
import type { FastifyInstance } from "fastify";

/** Supported font file extensions */
const FONT_EXTENSIONS = new Set([".woff2", ".woff", ".ttf", ".otf"]);

/** Map common filename suffixes to CSS weight/style */
const WEIGHT_MAP: Record<string, { weight: number; style: string }> = {
	thin: { weight: 100, style: "normal" },
	extralight: { weight: 200, style: "normal" },
	light: { weight: 300, style: "normal" },
	regular: { weight: 400, style: "normal" },
	medium: { weight: 500, style: "normal" },
	semibold: { weight: 600, style: "normal" },
	bold: { weight: 700, style: "normal" },
	extrabold: { weight: 800, style: "normal" },
	black: { weight: 900, style: "normal" },
	thinitalic: { weight: 100, style: "italic" },
	extralightitalic: { weight: 200, style: "italic" },
	lightitalic: { weight: 300, style: "italic" },
	italic: { weight: 400, style: "italic" },
	mediumitalic: { weight: 500, style: "italic" },
	semibolditalic: { weight: 600, style: "italic" },
	bolditalic: { weight: 700, style: "italic" },
	extrabolditalic: { weight: 800, style: "italic" },
	blackitalic: { weight: 900, style: "italic" },
};

/**
 * Read the font family name from a TTF/OTF file's OpenType name table.
 * Returns the typographic family (nameID 16) if present, else family name (nameID 1).
 * Returns null if the file cannot be parsed (e.g. WOFF wrapper or corrupt data).
 */
function readFontFamily(filePath: string): string | null {
	try {
		const buf = readFileSync(filePath);
		const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

		// WOFF files have a different outer container — skip them (rare for user-dropped files)
		const signature = view.getUint32(0);
		if (signature === 0x774f4646) return null;

		// Read the OpenType offset table
		const offset = 0;
		const numTables = view.getUint16(offset + 4);

		// Find the 'name' table in the table directory
		let nameTableOffset = 0;
		for (let i = 0; i < numTables; i++) {
			const entryOffset = offset + 12 + i * 16;
			const tag =
				String.fromCharCode(view.getUint8(entryOffset)) +
				String.fromCharCode(view.getUint8(entryOffset + 1)) +
				String.fromCharCode(view.getUint8(entryOffset + 2)) +
				String.fromCharCode(view.getUint8(entryOffset + 3));
			if (tag === "name") {
				nameTableOffset = view.getUint32(entryOffset + 8);
				break;
			}
		}

		if (nameTableOffset === 0) return null;

		// Parse the name table header
		const nameCount = view.getUint16(nameTableOffset + 2);
		const stringOffset = nameTableOffset + view.getUint16(nameTableOffset + 4);

		let family: string | null = null;
		let typoFamily: string | null = null;

		for (let i = 0; i < nameCount; i++) {
			const recordOffset = nameTableOffset + 6 + i * 12;
			const platformID = view.getUint16(recordOffset);
			const nameID = view.getUint16(recordOffset + 6);
			const length = view.getUint16(recordOffset + 8);
			const strOff = view.getUint16(recordOffset + 10);

			// Only read nameID 1 (family) and 16 (typographic family)
			if (nameID !== 1 && nameID !== 16) continue;

			const strStart = stringOffset + strOff;
			let name: string;

			if (platformID === 3) {
				// Windows — UTF-16BE
				const chars: string[] = [];
				for (let j = 0; j < length; j += 2) {
					chars.push(String.fromCharCode(view.getUint16(strStart + j)));
				}
				name = chars.join("");
			} else if (platformID === 1) {
				// Macintosh — single-byte encoding (ASCII-compatible for Latin)
				const chars: string[] = [];
				for (let j = 0; j < length; j++) {
					chars.push(String.fromCharCode(view.getUint8(strStart + j)));
				}
				name = chars.join("");
			} else {
				continue;
			}

			if (nameID === 16) typoFamily = name;
			if (nameID === 1) family = name;
		}

		return typoFamily ?? family;
	} catch {
		return null;
	}
}

/**
 * Parse a font file into family + weight/style.
 * Reads the real font family name from the file's OpenType name table.
 * Falls back to a camelCase-splitting heuristic when the file cannot be parsed.
 *
 * Examples (TTF/OTF with name table):
 *   "FiraCodeNerdFont-Regular.ttf"   → family="FiraCode Nerd Font", weight=400, style="normal"
 *   "FiraCodeNerdFont-Bold.ttf"      → family="FiraCode Nerd Font", weight=700, style="normal"
 *   "JetBrainsMono-LightItalic.ttf"  → family="JetBrains Mono", weight=300, style="italic"
 */
function parseFontFile(
	fontsDir: string,
	filename: string,
): { family: string; weight: number; style: string } | null {
	const ext = extname(filename);
	if (!FONT_EXTENSIONS.has(ext.toLowerCase())) return null;

	const base = basename(filename, ext);
	const parts = base.split("-");

	// Family is the first part (before the first dash)
	const familySlug = parts[0];
	if (!familySlug) return null;

	// Try to read the real font family name from the file's name table
	const realName = readFontFamily(join(fontsDir, filename));
	// Fallback: insert spaces before uppercase sequences: "JetBrainsMono" → "JetBrains Mono"
	const family = realName ?? familySlug.replace(/([a-z])([A-Z])/g, "$1 $2");

	// Variant is the second part (after dash), lowercased for lookup
	const variantRaw = parts.slice(1).join("").toLowerCase();
	const variant = WEIGHT_MAP[variantRaw] ?? { weight: 400, style: "normal" };

	return { family, weight: variant.weight, style: variant.style };
}

/**
 * Scan a fonts directory and return grouped font families.
 */
export function scanFonts(fontsDir: string): FontFamily[] {
	if (!existsSync(fontsDir)) return [];

	let entries: string[];
	try {
		entries = readdirSync(fontsDir);
	} catch {
		return [];
	}

	const familyMap = new Map<string, FontFile[]>();

	for (const entry of entries) {
		const parsed = parseFontFile(fontsDir, entry);
		if (!parsed) continue;

		const files = familyMap.get(parsed.family) ?? [];
		files.push({
			style: parsed.style,
			weight: parsed.weight,
			url: `/public/fonts/${entry}`,
		});
		familyMap.set(parsed.family, files);
	}

	// Sort families alphabetically, files by weight then style
	const result: FontFamily[] = [];
	for (const [family, files] of [...familyMap.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
		files.sort((a, b) => a.weight - b.weight || a.style.localeCompare(b.style));
		result.push({ family, files });
	}

	return result;
}

/**
 * Register the GET /api/fonts route.
 * No auth required — font list is not sensitive.
 */
export function registerFontRoutes(server: FastifyInstance, configDir: string): void {
	const fontsDir = join(configDir, "fonts");

	server.get("/api/fonts", async () => {
		return scanFonts(fontsDir);
	});
}
