/**
 * build-sea-agent.ts
 *
 * esbuild bundler for the nexterm-agent Node SEA binary.
 *
 * Bundles packages/agent/src/main.ts into a single CJS file at
 * dist/sea/nexterm-agent.cjs suitable for embedding in a Node SEA blob.
 *
 * Key decisions:
 * - Format: CJS  — Node SEA requires a CJS entry for process.dlopen compat.
 * - node-pty: external — the .node binary is embedded as a SEA asset and
 *   loaded via sea-addon-loader.ts at startup.
 * - @nexterm/shared: inlined — workspace package, not a published dep.
 * - @xterm/*, @msgpack/msgpack: inlined.
 * - Sourcemaps: disabled — SEA doesn't support source-mapped stack traces.
 * - Minify: disabled — easier debugging, size is not critical (~1 MB JS).
 */

import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type BuildOptions, type Plugin, build } from "esbuild";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(__dirname, "..");
const AGENT_ENTRY = join(ROOT, "packages", "agent", "src", "main.ts");
const OUT_DIR = join(ROOT, "dist", "sea");
const OUT_FILE = join(OUT_DIR, "nexterm-agent.cjs");

/**
 * esbuild plugin that replaces node-pty's utils.js with a SEA-compatible shim.
 *
 * node-pty's `utils.js` contains `loadNativeModule()` which tries multiple
 * relative paths like `require('../build/Release/pty.node')`. These dynamic
 * string-concatenated paths can't be intercepted by esbuild's static resolver.
 *
 * Instead, we replace the ENTIRE `utils.js` with a version where:
 * - In SEA mode: `loadNativeModule` returns { dir: '', module: __seaPtyExports }
 * - In normal mode: falls back to the standard relative-path search.
 *
 * `__seaPtyExports` is the dlopen'd native addon exports set by the banner.
 */
function nodePtyNativeShimPlugin(): Plugin {
	return {
		name: "node-pty-native-shim",
		setup(build) {
			// Intercept loading of node-pty's utils.js using the full filesystem
			// path (pnpm virtual store). The onLoad filter matches the absolute path.
			build.onLoad({ filter: /node-pty.*lib[\\/]utils\.js$/ }, () => ({
				contents: `
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadNativeModule = exports.assign = void 0;

function assign(target) {
  var sources = Array.prototype.slice.call(arguments, 1);
  sources.forEach(function(source) {
    Object.keys(source).forEach(function(key) { target[key] = source[key]; });
  });
  return target;
}
exports.assign = assign;

function loadNativeModule(name) {
  // SEA mode: pty.node was dlopen'd at startup and its exports are in __seaPtyExports.
  if (typeof __seaPtyExports !== 'undefined' && __seaPtyExports) {
    return { dir: '__sea__', module: __seaPtyExports };
  }
  // Normal Node.js mode: search relative paths as usual.
  var dirs = ['build/Release', 'build/Debug', 'prebuilds/' + process.platform + '-' + process.arch];
  var relative = ['..', '.'];
  var lastError;
  for (var i = 0; i < dirs.length; i++) {
    for (var j = 0; j < relative.length; j++) {
      var dir = relative[j] + '/' + dirs[i] + '/';
      try {
        return { dir: dir, module: require(dir + '/' + name + '.node') };
      } catch (e) { lastError = e; }
    }
  }
  throw new Error('Failed to load native module: ' + name + '.node, checked: ' + dirs.join(', ') + ': ' + lastError);
}
exports.loadNativeModule = loadNativeModule;
`,
				loader: "js",
			}));
		},
	};
}

/**
 * esbuild plugin — no-op shim; kept for future import.meta handling.
 */
function importMetaShimPlugin(): Plugin {
	return {
		name: "import-meta-shim",
		setup(_build) {
			// The `define` option handles import.meta.url globally.
		},
	};
}

/**
 * Inline CJS banner that bootstraps the SEA native addon BEFORE any module
 * code in the bundle runs.
 *
 * Strategy:
 *   1. Detect SEA mode via node:sea.
 *   2. Extract pty.node from SEA assets to the version-scoped cache dir.
 *   3. dlopen the .node file; store exports in `__seaPtyExports`.
 *
 * `__seaPtyExports` is consumed by the virtual `pty-native-shim` module
 * provided by `nodePtyNativeShimPlugin`. Every `require("*.node")` in the
 * node-pty JS layer is redirected to that shim, which returns __seaPtyExports.
 *
 * In normal Node.js mode (no SEA), __seaPtyExports is undefined and the shim
 * falls back to the regular require(), which works because node-pty can find
 * its .node binary on disk.
 *
 * NOTE: This extraction logic mirrors packages/agent/src/sea-addon-loader.ts
 * (canonical source). Changes here must be reflected there, and vice versa.
 */
const SEA_BOOTSTRAP_BANNER = `
// ── SEA native addon bootstrap ────────────────────────────────────────────────
var __seaPtyExports;
(function __seaBootstrap() {
  var _sea;
  try { _sea = require('node:sea'); } catch (_) {}
  if (!_sea || typeof _sea.isSea !== 'function' || !_sea.isSea()) return;

  var _fs   = require('node:fs');
  var _os   = require('node:os');
  var _path = require('node:path');

  // Version-scoped cache dir so upgrades extract fresh binaries.
  var _version = '0.0.0';
  try {
    if (typeof _sea.getAsset === 'function') {
      _version = _sea.getAsset('VERSION', 'utf8').trim();
    }
  } catch (_) {}

  var _cacheBase = process.env['XDG_CACHE_HOME'] ||
    (process.platform === 'win32'
      ? _path.join(process.env['LOCALAPPDATA'] || _os.homedir(), 'nexterm', 'cache')
      : _path.join(_os.homedir(), '.cache', 'nexterm'));
  var _cacheDir = _path.join(_cacheBase, 'addons', _version);
  var _ptyPath  = _path.join(_cacheDir, 'pty.node');

  // Extract pty.node from SEA asset blob (idempotent: skip if same size).
  try {
    var _blob = _sea.getRawAsset('pty.node');
    var _data = Buffer.from(_blob);
    var _shouldWrite = true;
    if (_fs.existsSync(_ptyPath)) {
      try { if (_fs.statSync(_ptyPath).size === _data.byteLength) _shouldWrite = false; }
      catch (_) {}
    }
    if (_shouldWrite) {
      _fs.mkdirSync(_cacheDir, { recursive: true });
      _fs.writeFileSync(_ptyPath, _data, { mode: 0o755 });
    }
  } catch (err) {
    process.stderr.write('[nexterm-agent] fatal: cannot extract pty.node: ' + err + '\\n');
    process.exit(1);
  }

  // dlopen pty.node and expose its exports via __seaPtyExports.
  var _ptyMod = { id: _ptyPath, filename: _ptyPath, loaded: true, exports: {} };
  try {
    process.dlopen(_ptyMod, _ptyPath);
  } catch (err) {
    process.stderr.write('[nexterm-agent] fatal: dlopen pty.node failed: ' + err + '\\n');
    process.exit(1);
  }
  __seaPtyExports = _ptyMod.exports;
})();
// ── end SEA bootstrap ─────────────────────────────────────────────────────────
`.trim();

export const buildOptions: BuildOptions = {
	entryPoints: [AGENT_ENTRY],
	bundle: true,
	platform: "node",
	target: "node22",
	format: "cjs",
	outfile: OUT_FILE,
	sourcemap: false,
	minify: false,
	// node-pty JS layer is bundled inline; only the .node binary require() is
	// shimmed by nodePtyNativeShimPlugin to use the dlopen'd __seaPtyExports.
	// All other deps (@nexterm/shared, @xterm/*, @msgpack/msgpack) are inlined.
	// Shim import.meta.url for the ESM→CJS bundle.
	define: {
		"import.meta.url": "__importMetaUrl",
	},
	banner: {
		js: [
			"#!/usr/bin/env node",
			"const __importMetaUrl = require('url').pathToFileURL(__filename).href;",
			SEA_BOOTSTRAP_BANNER,
		].join("\n"),
	},
	plugins: [nodePtyNativeShimPlugin(), importMetaShimPlugin()],
	logLevel: "info",
};

async function main(): Promise<void> {
	mkdirSync(OUT_DIR, { recursive: true });

	console.log(`[build-sea-agent] bundling ${AGENT_ENTRY}`);
	console.log(`[build-sea-agent] output  → ${OUT_FILE}`);

	const result = await build(buildOptions);

	if (result.errors.length > 0) {
		console.error("[build-sea-agent] build failed:");
		for (const err of result.errors) {
			console.error(" ", err.text);
		}
		process.exit(1);
	}

	console.log("[build-sea-agent] done.");
}

// Only run when invoked directly (not when imported by tests).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	main().catch((err: unknown) => {
		console.error("[build-sea-agent] fatal:", err);
		process.exit(1);
	});
}
