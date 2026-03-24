# SSH Key Picker — Design Spec

## Problem

SSH key path is a plain text input in the HostModal. Users must know and type the exact path to their private key. No way to discover available keys, verify key type/fingerprint, or upload new keys.

## Solution

Add a "Browse" button next to the key path input that opens a modal SSH key picker. The modal lists private keys found in `~/.ssh/` with metadata (type, size, date, fingerprint), supports subdirectory navigation via breadcrumb, and allows drag & drop key upload with automatic permission setting.

## Scope

- Browse modal: constrained to `~/.ssh/` (Linux/macOS) / `%USERPROFILE%\.ssh` (Windows)
- Text input: accepts any path (no restriction, like `ssh -i`)
- Upload: writes to current browsed directory within `~/.ssh/`, sets `chmod 600` (Unix) / restrictive ACL (Windows)

## API

### New endpoints

All SSH key endpoints require authentication (Bearer token). No auth bypass in server.ts — unlike fonts/wallpapers GET.

#### `GET /api/ssh-keys?dir=`

List private keys and subdirectories in a directory within `~/.ssh/`.

- **Query param**: `dir` — relative path within `~/.ssh/` (default: empty = root). E.g., `dir=deploy-keys`
- **Containment**: resolve `join(sshDir, dir)` and verify `startsWith(resolve(sshDir))`. Reject traversal.
- **Symlinks**: use `lstatSync` — skip symlinks entirely (prevents escape from `~/.ssh/` via symlinked directories or files).
- **File size guard**: skip files > 1 MB (no private key exceeds this). Prevents memory exhaustion from large files in `~/.ssh/`.
- **Behavior**: scan directory, for each entry:
  - **Directory** (real, not symlink): return `{ name, type: "directory", items: count }`
  - **File** (real, not symlink, ≤ 1 MB): attempt `ssh2.utils.parseKey(readFileSync(path))` in try-catch. If valid private key: return `{ name, type: "key", algorithm, bits, fingerprint, encrypted, mtime }`. If not a private key or parse error: skip.
- **Response**: `{ path: string, entries: SshKeyEntry[] }` where `path` is always **relative to `~/.ssh/`** (empty string for root, `"deploy-keys"` for a subdirectory). Never an absolute path.
- **mkdir**: if `~/.ssh/` doesn't exist, create with `mkdirSync(sshDir, { recursive: true, mode: 0o700 })`. On Windows, rely on default USERPROFILE subdirectory permissions.
- **Auth**: required
- **Errors**: 400 (traversal), 404 (directory not found)

**Types** (in `packages/shared/src/entities.ts` — follows FontFamily/FontFile precedent):
```typescript
interface SshKeyEntry {
  name: string;
  type: "directory" | "key";
  // directory fields
  items?: number;
  // key fields
  algorithm?: string;    // "ED25519", "RSA", "ECDSA", "DSA"
  bits?: number;         // 256, 4096, 384...
  fingerprint?: string;  // "SHA256:..."
  encrypted?: boolean;
  mtime?: string;        // ISO 8601
}
```

#### `POST /api/ssh-keys`

Upload a private key file to `~/.ssh/` (or subdirectory).

- **Multipart form data**: `file` (single file) + `dir` field (optional, relative path within `~/.ssh/`)
- **Validation**:
  - `sanitizeFilename()` — extract to shared `packages/hub/src/api/upload-utils.ts` (currently duplicated in fonts.ts and wallpapers.ts — DRY fix)
  - Containment check on target path
  - File size: reject > 100 KB after `toBuffer()` (defense-in-depth; no key exceeds this)
  - Verify file is a valid private key via `ssh2.utils.parseKey()`
  - Reject if file already exists (409)
- **Permissions**: after write:
  - Unix: `fs.chmod(target, 0o600)` (Node.js syscall, no shell)
  - Windows: `fs.chmod(target, 0o600)` (NTFS maps this). If insufficient, use `execFileNoThrow("icacls", [target, "/inheritance:r", "/grant:r", `${username}:R`])` from `src/utils/execFileNoThrow.ts` (argument array — safe from injection).
- **Response**: `{ name, algorithm, bits, fingerprint, encrypted }` — the parsed key metadata
- **Auth**: required
- **Errors**: 400 (not a valid key, bad filename, too large), 409 (exists)

#### `DELETE /api/ssh-keys?name=&dir=`

Delete a key file from `~/.ssh/`. Uses query params (not path param) to avoid URL encoding edge cases with key filenames containing dots or special characters.

- **Query**: `name` — filename, `dir` — relative subdirectory (optional)
- **Containment**: resolve `join(sshDir, dir, name)` + `startsWith(resolve(sshDir))` + `sanitizeFilename(name)`
- **Auth**: required
- **Errors**: 400 (bad filename, traversal), 404 (not found)

## Theme System — Semantic Badge Colors

Add semantic badge color variables to the theme system (Tier 2 — UI chrome):

```css
--nt-badge-info: #89b4fa;      /* blue — informational (ED25519, etc.) */
--nt-badge-warning: #f9e2af;   /* yellow — caution (RSA legacy, etc.) */
--nt-badge-success: #a6e3a1;   /* green — good (ECDSA, etc.) */
--nt-badge-danger: #f38ba8;    /* red — attention (encrypted, error) */
```

Values above are catppuccin-mocha defaults. Each theme definition must include these 4 new variables. Badge backgrounds use the color at 13% opacity (`color-mix` or hex with alpha).

**Integration**:
- Add to `base.css` variable declarations (update variable count comment)
- Add default values in `ThemeManager` / `applyTheme()` so existing themes get catppuccin-mocha defaults as fallback
- Theme editor: add badge color fields to the custom theme editor

Algorithm-to-badge mapping:
- ED25519 → `--nt-badge-info` (modern, recommended)
- ECDSA → `--nt-badge-success`
- RSA → `--nt-badge-warning` (legacy but common)
- DSA → `--nt-badge-danger` (deprecated)
- "encrypted" badge → `--nt-badge-danger`

## Components

### SshKeyPicker.vue (new)

Modal component. Same dialog pattern as FontPicker.

**Props**:
- `modelValue: string | undefined` — current key path
- `show: boolean`

**Emits**:
- `update:modelValue(path: string)` — full tilde path (`~/.ssh/subdir/keyname`)
- `close`

**Structure**:
```
<Teleport to="body">
  <div class="dialog-overlay">
    <div class="ssh-key-picker-dialog">   ← 560px max-width
      <header>
        "SSH Keys" + count badge
        "+ Upload key" button + close ✕
      </header>
      <nav class="breadcrumb">
        ~/.ssh / subdir / ...          ← clickable segments
      </nav>
      <div class="ssh-key-list">       ← max-height: 360px, overflow-y: auto
        <SshKeyCard v-for />
        (empty state if no keys found)
      </div>
      <footer>
        "Drop private key files anywhere to upload"
      </footer>
      <div v-if="isDragging" class="drop-overlay" />
    </div>
  </div>
</Teleport>
```

**Behavior**:
- On mount: fetch `GET /api/ssh-keys` (root `~/.ssh/`)
- Directory click: fetch `GET /api/ssh-keys?dir=<subdir>`, update breadcrumb
- Breadcrumb click: navigate back to that level
- Key click: construct tilde path from API `path` field + key name → emit `update:modelValue("~/.ssh/<path>/<name>")` (or `"~/.ssh/<name>"` if path is empty) → close
- Upload: drop or file input → `POST /api/ssh-keys` with current `dir` → reload
- Delete: `DELETE /api/ssh-keys?name=<name>&dir=<dir>` → reload
- Drag state: `useFileDrop` composable (accept all extensions — keys have no standard ext)

### SshKeyCard.vue (new)

Single entry in the list.

**Props**:
- `entry: SshKeyEntry`
- `selected: boolean`

**Emits**:
- `select` — key or directory clicked
- `delete` — delete confirmed (keys only)

**Structure**:
- **Directory**: folder icon + name + item count → click navigates
- **Key**: key icon + name + badges (algorithm colored via `--nt-badge-*`, bits, date, encrypted) + fingerprint (truncated, `title` attr for full) + delete button with inline confirm
- Badges row wraps on narrow width

### HostModal integration

In the SSH "key" auth section of HostModal.vue, replace the `<input type="text">` with:

```html
<div class="key-path-row">
  <input type="text" v-model="form.sshKeyPath" placeholder="~/.ssh/id_ed25519" />
  <button @click="showKeyPicker = true">Browse</button>
</div>
<SshKeyPicker
  :show="showKeyPicker"
  :model-value="form.sshKeyPath"
  @update:model-value="form.sshKeyPath = $event"
  @close="showKeyPicker = false"
/>
```

The text input remains free-form — users can type any path.

## File structure

```
packages/clients/web/src/
  components/
    SshKeyPicker.vue           ← new
    SshKeyCard.vue             ← new
  composables/
    useFileDrop.ts             ← rename from useFontDrop (parameterized extensions)
    useFileDrop.spec.ts        ← rename from useFontDrop.spec.ts
packages/hub/src/
  api/
    ssh-keys.ts                ← new (GET list + POST upload + DELETE)
    upload-utils.ts            ← new (extract sanitizeFilename from fonts.ts + wallpapers.ts)
packages/shared/src/
  entities.ts                  ← add SshKeyEntry type
```

### useFontDrop → useFileDrop refactor

Rename `useFontDrop.ts` → `useFileDrop.ts`, `useFontDrop.spec.ts` → `useFileDrop.spec.ts`. Parameterize accepted extensions:

```typescript
function useFileDrop(
  onFiles: (files: File[]) => void,
  acceptedExtensions?: Set<string>,  // undefined = accept all files
): { isDragging, onDragEnter, onDragOver, onDragLeave, onDrop }
```

**Migration checklist**:
- Rename files: `useFontDrop.ts` → `useFileDrop.ts`, `useFontDrop.spec.ts` → `useFileDrop.spec.ts`
- Update import path in `FontPicker.vue`: `"../../composables/useFontDrop.js"` → `"../../composables/useFileDrop.js"`
- FontPicker calls: `useFileDrop(onFiles, new Set([".ttf", ".otf", ".woff", ".woff2"]))`
- SshKeyPicker calls: `useFileDrop(onFiles)` (no extension filter)
- Update spec tests: rename function references

### sanitizeFilename extraction

Extract `sanitizeFilename()` from `fonts.ts` and `wallpapers.ts` into `packages/hub/src/api/upload-utils.ts`. Update both files to import from there. SSH keys endpoint also imports from there.

## Error handling

| Scenario | Behavior |
|----------|----------|
| Upload not a valid key | Toast error "Not a valid SSH private key" |
| Upload too large (> 100 KB) | Toast error "File too large for an SSH key" |
| Upload duplicate | Toast error "Key file already exists: <name>" |
| Upload permission error | Toast error "Failed to set permissions on key file" |
| Directory traversal attempt | 400 error, blocked server-side |
| Key file unreadable / parse error | Skip in listing (don't show broken entries) |
| Symlink encountered | Skip (don't follow, don't show) |
| File > 1 MB in listing | Skip (not a key) |
| Empty directory | "No private keys found in this directory" |
| `~/.ssh` doesn't exist | Create with `mkdir -p` + `chmod 700` (Unix) / default perms (Windows) |

## Security considerations

- **Containment**: browse API strictly contained to `~/.ssh/` via `resolve().startsWith()` check
- **Symlinks**: skipped entirely in listing (prevents containment escape)
- **File size**: 1 MB cap on listing reads, 100 KB cap on uploads
- **Text input**: free-form, no filesystem browsing — just stores a path string
- **Permissions**: upload auto-sets `chmod 600` (Unix) / `fs.chmod` (Windows)
- **No shell interpolation**: Windows ACL via `execFileNoThrow` with argument array if needed
- **Key content**: never sent to the client. Only metadata (algorithm, bits, fingerprint) is returned by the API
- **Passphrase**: never involved in browse/upload — only at connect time (existing flow)
- **sanitizeFilename**: shared utility, not duplicated — single point of validation

## Out of scope

- Key generation (ssh-keygen)
- Key pair management (associate .pub with private)
- SSH agent management
- Key conversion between formats
