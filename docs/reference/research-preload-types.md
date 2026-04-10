# Preload Script Type Declaration for Renderer (Electron + electron-vite + TypeScript)

## Overview

When a preload script uses `contextBridge.exposeInMainWorld('api', {...})`, the exposed object becomes available on `window.api` inside the renderer process. TypeScript does not know about this by default — the type is either absent or typed as `unknown`. This document describes the canonical patterns for declaring `window.api` types so that the renderer gets full IntelliSense, with specific attention to how electron-vite projects should be structured.

---

## Key Concepts

- **Context Bridge**: Electron's security boundary between the preload and renderer. `contextBridge.exposeInMainWorld(key, value)` attaches `value` to `window[key]` inside the renderer.
- **Declaration merging**: TypeScript allows you to extend the built-in `Window` interface via `interface Window { ... }` inside a `declare global` block in any `.d.ts` file.
- **`typeof import(...)`**: A TypeScript feature that infers the type of a module's export at compile time. Used to keep renderer types automatically in sync with the preload implementation.
- **`@electron-toolkit/preload`**: An optional npm package that provides pre-typed Electron APIs (`ipcRenderer`, `webFrame`, `process`) and a ready-made `ElectronAPI` type for the standard electron-vite template.

---

## electron-vite Built-in Support

electron-vite does **not** auto-generate `.d.ts` files for preload exports (as of April 2026 — see [issue #141](https://github.com/alex8088/electron-vite/issues/141)). It does provide:

- A `/// <reference types="electron-vite/node" />` directive (or equivalent `types` array entry in `tsconfig.json`) that gives IntelliSense for the `electron.vite.config.ts` file itself — this is **not** related to `window.api` typing.
- A project template that ships `src/preload/index.d.ts` pre-configured to use `@electron-toolkit/preload`'s `ElectronAPI` type with `api: unknown` as a placeholder.

The developer is responsible for replacing `api: unknown` with the actual type.

---

## Declaring `window.api` Types: Three Patterns

### Pattern 1 — Manual Interface (Simplest, Requires Manual Sync)

Define an explicit TypeScript interface that mirrors what the preload exposes, then augment the global `Window` interface in a `.d.ts` file.

**Preload (`src/preload/index.ts`):**
```ts
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  ping: () => ipcRenderer.invoke('ping'),
  openFile: (path: string) => ipcRenderer.invoke('open-file', path),
})
```

**Declaration file (`src/preload/index.d.ts`):**
```ts
export interface Api {
  ping: () => Promise<string>
  openFile: (path: string) => Promise<void>
}

declare global {
  interface Window {
    api: Api
  }
}
```

Drawback: the interface must be manually kept in sync with the preload implementation. A mismatch will not be caught by the compiler.

---

### Pattern 2 — `typeof import(...)` (Recommended, Auto-Synced)

Extract the API object into a separate module. Use `typeof import(...)` in the declaration file to derive the type directly from the implementation. The types can never drift out of sync.

**Step 1 — Extract API to its own file (`src/preload/api.ts`):**
```ts
import { ipcRenderer } from 'electron'

export const api = {
  ping: () => ipcRenderer.invoke('ping'),
  openFile: (path: string) => ipcRenderer.invoke('open-file', path),
}
```

**Step 2 — Use `api.ts` in the preload entry (`src/preload/index.ts`):**
```ts
import { contextBridge } from 'electron'
import { api } from './api'

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.api = api
}
```

**Step 3 — Declare `window.api` using `typeof import(...)` (`src/preload/index.d.ts`):**
```ts
declare global {
  interface Window {
    api: typeof import('./api').api
  }
}
```

Now if you add, remove, or rename a method in `api.ts`, the renderer's `window.api` type updates automatically — no manual changes to the declaration file are needed.

---

### Pattern 3 — Shared Interface Contract (Strictest, Compile-Time Enforcement)

Define an explicit interface in a location shared by both processes. The preload implementation is then type-checked against this interface, and the renderer declaration references it. This catches mismatches in the preload as well.

**Shared types file (`src/types/electron-api.d.ts` or `src/shared/api.ts`):**
```ts
export interface ElectronAPI {
  ping: () => Promise<string>
  openFile: (path: string) => Promise<void>
}
```

**Preload (`src/preload/index.ts`):**
```ts
import { contextBridge, ipcRenderer } from 'electron'
import type { ElectronAPI } from '../types/electron-api'

const api: ElectronAPI = {
  ping: () => ipcRenderer.invoke('ping'),
  openFile: (path) => ipcRenderer.invoke('open-file', path),
}

contextBridge.exposeInMainWorld('api', api)
```

TypeScript will now error at compile time if the preload implementation does not satisfy `ElectronAPI`.

**Renderer declaration file (`src/preload/index.d.ts` or `src/renderer/src/env.d.ts`):**
```ts
import type { ElectronAPI } from '../types/electron-api'

declare global {
  interface Window {
    api: ElectronAPI
  }
}
```

---

## Where to Place the Declaration File

### electron-vite Default Template Convention

The electron-vite template places the declaration at `src/preload/index.d.ts`. This file is automatically referenced by the renderer's `tsconfig` because the renderer's `tsconfig.json` typically has:

```json
{
  "include": ["src/**/*.ts", "src/**/*.d.ts", "src/**/*.tsx"]
}
```

The `src/preload/index.d.ts` file falls under this glob, so it is included without any extra configuration.

### Alternative: Declaration Inside the Renderer Source Tree

Some teams place the declaration in the renderer source directly, for example `src/renderer/src/env.d.ts`. This is also valid and makes it very clear that the file is specifically for the renderer's global scope.

### Summary of Placement Options

| File Location | When to Use |
|---|---|
| `src/preload/index.d.ts` | electron-vite default; picked up by renderer tsconfig glob |
| `src/renderer/src/env.d.ts` | Explicit renderer-only declaration; unambiguous scope |
| `src/types/global.d.ts` or `src/shared/` | Shared interface pattern; reused across processes |

---

## tsconfig.json Configuration

### Renderer tsconfig (`src/renderer/tsconfig.json`)

Ensure the `include` glob covers `.d.ts` files. The electron-vite default template already does this:

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "composite": true,
    "baseUrl": ".",
    "paths": {}
  },
  "include": ["src/**/*.ts", "src/**/*.d.ts", "src/**/*.tsx"]
}
```

If `src/preload/index.d.ts` is outside the renderer's directory, you have two options:

**Option A — Extend include to cover the preload directory:**
```json
{
  "include": [
    "src/**/*.ts",
    "src/**/*.d.ts",
    "src/**/*.tsx",
    "../preload/index.d.ts"
  ]
}
```

**Option B — Copy or symlink the declaration into the renderer source tree.**

**Option C (most portable) — Move `window.api` declaration into the renderer's own `env.d.ts`** and use `typeof import('../preload/api').api` to derive the type. This avoids path gymnastics.

### Root `tsconfig.json` for electron-vite

No special entries are needed for `window.api` typing. The reference to `electron-vite/node` types is only for the build config file:

```json
{
  "compilerOptions": {
    "types": ["electron-vite/node"]
  }
}
```

---

## Using `@electron-toolkit/preload`

The standard electron-vite template scaffolds a preload that uses this package. It provides:

- `electronAPI`: a ready-to-expose object wrapping `ipcRenderer`, `webFrame`, `webUtils`, and `process`.
- `ElectronAPI`: the TypeScript type for the above object.

**Preload (`src/preload/index.ts`):**
```ts
import { contextBridge } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { api } from './api'          // your custom API

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  window.electron = electronAPI
  window.api = api
}
```

**Declaration file (`src/preload/index.d.ts`):**
```ts
import { ElectronAPI } from '@electron-toolkit/preload'

declare global {
  interface Window {
    electron: ElectronAPI
    api: typeof import('./api').api
  }
}
```

---

## Best Practices

1. **Prefer Pattern 2 (`typeof import(...)`)** for custom `window.api` in most projects. It gives automatic sync with zero boilerplate overhead.

2. **For large APIs with many IPC channels**, use Pattern 3 (shared interface) so that both the preload implementation and the renderer declaration are independently checked against the same contract. This scales better and catches bugs in both directions.

3. **Never define `window.api` types inline in component files.** Always use a `.d.ts` file so the augmentation is global and available everywhere in the renderer without any import.

4. **Do not use `as unknown as MyType` casts in the renderer.** If `window.api` is typed correctly via a declaration file, no casting is needed.

5. **Keep IPC channel names and argument types co-located with the interface definition.** A common mistake is scattering channel name strings across files; centralizing them enables refactoring and avoids typos.

6. **For `ipcRenderer.on(...)` event listeners**, always include a cleanup call (`ipcRenderer.removeListener`) and expose a typed `onXxx` / `removeXxx` pair on the API object so the renderer can manage listener lifecycle safely.

---

## Common Pitfalls

| Pitfall | Description | Fix |
|---|---|---|
| `window.api` typed as `unknown` | Default in electron-vite template placeholder | Replace with actual type using one of the three patterns above |
| Declaration file not included in renderer tsconfig | The `.d.ts` is present but outside the `include` glob | Extend `include` to cover the preload declaration path |
| Using `import` inside a `.d.ts` file without `declare global` | Turns the file into a module, breaking global augmentation | Always wrap `interface Window` in `declare global { }` when the file contains any `import` statement |
| Exposing class instances via contextBridge | contextBridge only serializes plain objects, arrays, primitives, and functions | Use plain objects with function properties only |
| Forgetting `async`/`Promise` on IPC invoke calls | `ipcRenderer.invoke` always returns `Promise<any>` | Always type return values as `Promise<T>` |

---

## Complete Working Example (electron-vite, React, TypeScript)

### File structure
```
src/
  preload/
    api.ts              # API implementation
    index.ts            # contextBridge wiring
    index.d.ts          # window type declaration
  renderer/
    src/
      App.tsx
    tsconfig.json       # includes ../preload/index.d.ts or uses glob
  types/                # optional: shared contracts
```

### `src/preload/api.ts`
```ts
import { ipcRenderer } from 'electron'

export const api = {
  ping: (): Promise<string> => ipcRenderer.invoke('ping'),
  readFile: (path: string): Promise<string> => ipcRenderer.invoke('read-file', path),
  onFileChanged: (callback: (path: string) => void): void => {
    ipcRenderer.on('file-changed', (_event, path: string) => callback(path))
  },
  removeFileChangedListener: (callback: (path: string) => void): void => {
    ipcRenderer.removeListener('file-changed', (_event, path) => callback(path))
  },
}
```

### `src/preload/index.ts`
```ts
import { contextBridge } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { api } from './api'

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  window.electron = electronAPI
  window.api = api
}
```

### `src/preload/index.d.ts`
```ts
import { ElectronAPI } from '@electron-toolkit/preload'

declare global {
  interface Window {
    electron: ElectronAPI
    api: typeof import('./api').api
  }
}
```

### `src/renderer/tsconfig.json`
```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "composite": true,
    "baseUrl": "."
  },
  "include": [
    "src/**/*.ts",
    "src/**/*.d.ts",
    "src/**/*.tsx",
    "../preload/index.d.ts"
  ]
}
```

### `src/renderer/src/App.tsx` (usage)
```tsx
// No import needed — window.api is globally typed
async function handlePing() {
  const result = await window.api.ping()  // IntelliSense: () => Promise<string>
  console.log(result)
}
```

---

## Assumptions & Scope

| Assumption | Confidence | Impact if Wrong |
|---|---|---|
| electron-vite default project structure (`src/main`, `src/preload`, `src/renderer`) is in use | HIGH | Path references in tsconfig `include` would need to be adjusted |
| Context isolation is enabled (default in Electron 20+) | HIGH | If disabled, types are still needed but the `else` branch in preload index becomes the active path |
| `@electron-toolkit/preload` is installed (default in electron-vite template) | MEDIUM | The `ElectronAPI` import in the declaration file would need to be removed; the pattern still works without it |
| No auto-generation of types from preload (as of April 2026) | HIGH | If electron-vite adds this feature, manual declaration files may become optional |

---

## References

1. [electron-vite Official Guide: Using Preload Scripts](https://electron-vite.org/guide/dev) — project structure, preload usage, sandboxing
2. [electron-vite TypeScript Documentation](https://github.com/alex8088/electron-vite-docs/blob/master/packages/en-US/docs/guide/typescript.md) — type definition setup for electron-vite config
3. [GitHub Issue #141: Auto-generate exposeInMainWorld typings](https://github.com/alex8088/electron-vite/issues/141) — community-documented pattern for `typeof import(...)` sync
4. [@electron-toolkit/preload on npm](https://www.npmjs.com/package/@electron-toolkit/preload) — ElectronAPI type and preload helper
5. [Electron Context Isolation Tutorial](https://www.electronjs.org/docs/latest/tutorial/context-isolation) — official Electron docs on contextBridge and security
6. [UI Development with Electron (emadibrahim.com)](https://www.emadibrahim.com/electron-guide/ui-development) — practical patterns for typed IPC in React + Electron
