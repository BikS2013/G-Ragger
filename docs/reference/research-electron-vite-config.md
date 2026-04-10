# electron-vite Configuration for External Source Directory

## Overview

This document covers the specific electron-vite v5 configuration required for the GeminiRAG Electron UI, where the main process must import TypeScript modules from a sibling directory (`../src/`) that uses ESM with NodeNext module resolution and `.js`-extension imports. The research validates configuration patterns for entry points, dependency bundling, watch mode, `.js` extension handling, and externals.

**Project layout context:**
```
macbook-desktop/GeminiRAG/
├── src/                        # Existing CLI service layer (ESM, NodeNext, .js imports)
│   ├── commands/
│   ├── services/
│   ├── config/
│   ├── types/
│   └── utils/
├── electron-ui/                # New Electron app
│   ├── src/
│   │   ├── main/main.ts        # Main process entry (imports from ../../src/)
│   │   ├── preload/preload.ts
│   │   └── renderer/
│   ├── electron.vite.config.ts
│   ├── package.json            # No "type":"module" — CJS default
│   └── tsconfig.json
└── package.json                # GeminiRAG root ("type":"module")
```

---

## Key Concepts

### How electron-vite Handles the Main Process

electron-vite uses **Rollup** (not esbuild) as its bundler for all three entry points (main, preload, renderer). The main and preload builds run in "library mode" with SSR semantics — this is what allows them to import Node.js built-ins freely. The renderer uses Vite's standard web bundling.

For the **main process**, the built-in defaults in electron-vite v5 are:

| Option | Default Value |
|--------|--------------|
| `build.lib.entry` | `src/main/{index\|main}.{js,ts,mjs,cjs}` |
| `build.lib.formats` | `['cjs']` (or `['es']` on Electron 28+ with ESM enabled) |
| `build.rollupOptions.external` | `electron` + all Node.js built-in modules |
| `build.outDir` | `out/main` |
| `build.ssr` | `true` (always, forces Node-side resolution) |
| `ssr.noExternal` | `true` (always — overrides dep externalization for the SSR context) |
| `resolve.conditions` | `['node']` — prefers `require` exports |
| `resolve.mainFields` | `['module', 'jsnext:main', 'jsnext']` |

The `build.externalizeDeps` feature (v5 replacement for the deprecated `externalizeDepsPlugin`) automatically externalizes anything listed in `package.json` `dependencies`. Anything in `devDependencies` that is imported gets **bundled** by default.

### The CJS Output Format

Since the `electron-ui/package.json` should NOT have `"type": "module"`, and because Electron < 28 requires CJS for the main process, the output format will be `cjs`. electron-vite selects this automatically based on the package.json type field. If the `electron-ui/package.json` omits `"type"` (defaults to CJS), electron-vite produces `.js` output files in CJS format. This is correct.

### The ESM Source Problem This Solves

The existing `../src/` files use:
- `"type": "module"` in the root `package.json`
- `"module": "NodeNext"` TypeScript module resolution
- `.js` extensions in all import statements (e.g., `import { loadConfig } from '../config/config.js'`)

At runtime, these `.js` imports map to `.ts` source files. Rollup (via electron-vite's build) resolves this at **build time**: it reads the `.ts` source, follows the `.js` import paths by finding the corresponding `.ts` files, and bundles everything into a single CJS output file. The `.js` extension in the import statement does not cause problems during the build — Rollup's TypeScript plugin handles the extension remapping transparently.

---

## Core Configuration

### `electron.vite.config.ts` — Complete Reference

```typescript
import { defineConfig } from 'electron-vite'
import { resolve } from 'path'

export default defineConfig({
  main: {
    // 1. Custom entry point (electron-vite can find src/main/main.ts by convention
    //    but being explicit is safer given the non-standard project layout)
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/main.ts')
        }
      },

      // 2. Watch mode: include the sibling src/ directory so changes there
      //    trigger a rebuild and Electron restart during development.
      //    This is a Rollup WatcherOptions object.
      watch: {
        include: [
          'src/**',          // electron-ui's own main/preload source
          '../src/**'        // GeminiRAG service layer (sibling directory)
        ]
      },

      // 3. Dependency bundling strategy:
      //    - electron and Node built-ins are always external (built-in default)
      //    - Third-party npm packages in electron-ui/package.json "dependencies"
      //      are externalized by default (externalizeDeps behavior)
      //    - Anything NOT in package.json dependencies gets bundled
      //
      //    For packages used by ../src/ that are in the GeminiRAG root
      //    package.json (not in electron-ui/package.json), they will be
      //    bundled into the output. This is the correct approach for a
      //    local-only desktop app.
      //
      //    If @google/genai causes bundling issues, mark it external here
      //    and add it to electron-ui/package.json dependencies instead:
      externalizeDeps: {
        exclude: []   // empty = use defaults; add package names here to force-bundle them
      },

      // 4. Source maps for debugging (main process only)
      sourcemap: true,
    },

    // 5. Resolve aliases: map the sibling src/ directory for editor IntelliSense
    //    and for any alias-based imports. For direct relative imports (../../src/...)
    //    no alias is needed — Rollup resolves them by path.
    //
    //    If you use path aliases like @cli/services/registry in main.ts,
    //    define them here and mirror in tsconfig.json paths.
    resolve: {
      alias: {
        '@cli': resolve(__dirname, '../src')
        // Example: '@cli/services/registry.js' -> '../src/services/registry.ts'
        // Note: alias is matched on the prefix, not the full path.
        // The .js extension in the import is handled by Rollup at build time.
      }
    }
  },

  preload: {
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/preload.ts')
        }
      },
      // Preload scripts are sandboxed by default (Electron 20+).
      // For a sandboxed preload that only uses contextBridge and ipcRenderer,
      // the default dependency handling works. If non-sandboxed (sandbox: false),
      // keep the defaults.
      sourcemap: true,
    }
  },

  renderer: {
    root: 'src/renderer',
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html')
        }
      }
    }
  }
})
```

---

## Focus Area 1: Resolving Imports from `../src/`

### How It Works Without Any Special Config

When `main.ts` contains:
```typescript
import { loadConfig } from '../../src/config/config.js'
import { listWorkspaces } from '../../src/services/registry.js'
```

Rollup (via electron-vite) resolves these paths as follows:
1. The path `../../src/config/config.js` is resolved relative to the importing file's location
2. Rollup's TypeScript plugin (via `@rollup/plugin-typescript` or esbuild transform) strips the `.js` extension and finds `config.ts`
3. The TypeScript source is compiled and inlined into the bundle

**No alias configuration is required for direct relative imports.** The `resolve.alias` is only needed if you want to write `import { loadConfig } from '@cli/config/config.js'` instead of a relative path.

### Why `resolve.alias` Is Needed for Editor IntelliSense

Even if the build works with relative imports, the editor (VSCode) needs `tsconfig.json` path mappings to provide IntelliSense across the `electron-ui/` → `../src/` boundary. These must be declared in both places:

**`electron-ui/tsconfig.json`:**
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "Node",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "sourceMap": true,
    "paths": {
      "@cli/*": ["../src/*"]
    }
  },
  "include": ["src/**/*"],
  "references": [
    { "path": "../tsconfig.json" }
  ]
}
```

**`electron.vite.config.ts`:**
```typescript
resolve: {
  alias: {
    '@cli': resolve(__dirname, '../src')
  }
}
```

**Important**: The `tsconfig.json` in `electron-ui/` should use `"module": "CommonJS"` and `"moduleResolution": "Node"` (not `NodeNext`), because the output is CJS. This avoids TypeScript requiring `.js` extensions in the main process source files within `electron-ui/src/main/`. The `../src/` files are compiled by Rollup, not by `tsc`, so they can keep their `NodeNext` resolution in the root `tsconfig.json`.

### Alias Ordering Caution

If multiple aliases are defined (e.g., both `@cli` and `@`), list the more specific ones first. The alias plugin applies the first match. For example:
```typescript
resolve: {
  alias: [
    { find: '@cli', replacement: resolve(__dirname, '../src') },
    { find: '@', replacement: resolve(__dirname, 'src') }
  ]
}
```
Using the array form instead of an object ensures ordering is explicit.

---

## Focus Area 2: Watch Mode for `../src/`

### The Problem

By default, Rollup's watcher only monitors files that are part of the module graph starting from the entry point. If a file in `../src/` is imported (directly or transitively), it **is** automatically watched. However, there is a subtle issue: files that are indirectly loaded (e.g., config files read via `fs.readFileSync` at runtime, not imported via `import`) are not in the module graph and will not trigger a rebuild.

### Configuration

Use `build.watch` with the `include` option (Rollup WatcherOptions):

```typescript
main: {
  build: {
    watch: {
      include: [
        'src/**',      // electron-ui's own source
        '../src/**'    // GeminiRAG service layer
      ]
    }
  }
}
```

This tells the Rollup watcher to monitor any file matching these globs, even if they are not explicitly in the import graph. Changes to any `.ts` file under `../src/` will trigger a rebuild of the main process and a restart of the Electron app.

**Note**: The `watch` option only takes effect when running in watch mode. It has no effect on `electron-vite build` (production builds).

### CLI Activation

Watch mode is activated with:
```bash
electron-vite dev --watch
# or shorthand:
electron-vite dev -w
```

The preferred approach is via the CLI flag rather than hardcoding `build.watch: {}` in the config, because it gives flexibility to run builds without watching.

**`electron-ui/package.json` scripts:**
```json
{
  "scripts": {
    "dev": "electron-vite dev --watch",
    "build": "electron-vite build",
    "preview": "electron-vite preview"
  }
}
```

---

## Focus Area 3: Handling `.js` Extension Imports

### The NodeNext Import Pattern

TypeScript's `NodeNext` module resolution requires that source files import other TypeScript files using the `.js` extension:
```typescript
// In ../src/services/registry.ts
import { AppConfig } from '../config/config.js'  // resolves to config.ts at build time
```

### How Rollup Handles This

When electron-vite's Rollup build encounters an import like `import X from '../config/config.js'`, it:
1. Attempts to resolve `config.js` relative to the current file
2. If `config.js` does not exist (because the source is `config.ts`), the TypeScript resolver falls back to trying `config.ts`
3. The `.ts` source is found and compiled

This fallback behavior is handled by the Rollup TypeScript plugin. It is **not** a configuration you need to set up — it works automatically when Rollup processes `.ts` files.

### When This Could Fail

If `electron-ui/` installs its own copy of a package that also exists in the GeminiRAG root `node_modules/`, and the package uses `.js` extension imports internally, there may be dual-install conflicts. This is avoided by NOT installing the same packages in both locations — use the GeminiRAG root `node_modules/` for shared service-layer dependencies and `electron-ui/node_modules/` only for Electron-specific packages.

### Alias-Based `.js` Handling

If you use an alias like `@cli/config/config.js`, the alias resolution strips `@cli` and resolves to `../src/config/config.js`. The same TypeScript fallback then finds `config.ts`. No special configuration is needed.

However, a regex alias can be used if you want explicit control over `.js`-to-`.ts` remapping:
```typescript
resolve: {
  alias: [
    {
      find: /^(@cli\/.+)\.js$/,
      replacement: '$1.ts'  // strip .js, Rollup finds .ts
    }
  ]
}
```
This is not recommended for the GeminiRAG project — the standard path resolution handles it without regex complexity.

---

## Focus Area 4: `resolve.alias` and Other Config Options

### When `resolve.alias` Is Needed vs Not Needed

| Import Style | `resolve.alias` Needed? | Reason |
|---|---|---|
| `import X from '../../src/services/registry.js'` | No | Direct relative path, Rollup resolves it |
| `import X from '@cli/services/registry.js'` | Yes | Alias must be defined in config |
| `import X from '@cli/services/registry'` | Yes | Alias + extension fallback |

**Recommendation**: Use direct relative imports (`../../src/`) in `main.ts` and service bridge files. Reserve aliases for any shared types in `src/shared/` that are imported from both main and renderer. This keeps the config simpler and avoids the alias-tsconfig synchronization problem.

### `resolve.conditions`

The built-in default `['node']` is correct for the main process. Do not override this. It ensures that when a package has conditional exports (`exports` field in package.json), the `node` condition is preferred — which means `require`-compatible CJS exports are selected over browser variants.

### `resolve.mainFields`

The built-in default `['module', 'jsnext:main', 'jsnext']` works correctly. For packages used by the service layer (like `@google/genai`), this allows Rollup to find the ESM entry point for bundling into the CJS output.

---

## Focus Area 5: Externals

### What Is Always External (Built-in electron-vite Behavior)

electron-vite v5 automatically externalizes:
- `electron` itself
- All Node.js built-in modules: `node:fs`, `node:path`, `node:os`, `node:crypto`, `fs`, `path`, `os`, `crypto`, etc.

You do not need to configure these manually. They appear in `build.rollupOptions.external` as defaults.

### What Gets Bundled

By default, everything NOT in `electron-ui/package.json` `dependencies` gets bundled. This includes:
- All modules imported from `../src/`
- All packages in `devDependencies`
- Any "phantom" dependencies (in `node_modules` but not declared)

For the GeminiRAG Electron UI, the service-layer packages (`@google/genai`, `dotenv`, `commander`, etc.) are in the GeminiRAG root `package.json`. Since they are not in `electron-ui/package.json` at all, they will be **bundled** into the main process output. This is acceptable for a local desktop app.

### Recommended `externalizeDeps` Strategy

For the main process, keep `externalizeDeps` at its default. The only case where you would change it:

**Scenario A**: `@google/genai` fails to bundle (rare, usually not an issue).
```typescript
// If @google/genai fails to bundle, mark it external and install in electron-ui/package.json
main: {
  build: {
    rollupOptions: {
      external: ['@google/genai']
    }
  }
}
```

**Scenario B**: You want to keep the bundle smaller by externalizing the Gemini SDK.
```typescript
// electron-ui/package.json:
// "dependencies": { "@google/genai": "*" }
// electron.vite.config.ts — externalizeDeps handles it automatically when it's in dependencies
```

**Scenario C**: A native Node.js addon is needed (not applicable for GeminiRAG, but noted for completeness).
```typescript
main: {
  build: {
    rollupOptions: {
      external: ['better-sqlite3']  // native addons cannot be bundled
    }
  }
}
```

### ESM-Only Packages in a CJS Bundle

If any package imported from `../src/` is ESM-only (e.g., a hypothetical future dependency), the bundle would fail with `ERR_REQUIRE_ESM`. The fix is:
```typescript
main: {
  build: {
    externalizeDeps: {
      exclude: ['esm-only-package']  // force it to be bundled as ESM-transformed-to-CJS
    }
  }
}
```

---

## Complete Validated Configuration

This is the complete `electron.vite.config.ts` suitable for the GeminiRAG electron-ui project:

```typescript
import { defineConfig } from 'electron-vite'
import { resolve } from 'path'

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/main.ts')
        }
        // build.rollupOptions.external is already set to:
        // ['electron', ...all Node.js built-ins]
        // by electron-vite's built-in config — no need to repeat it.
      },
      // Watch mode configuration. Only active when running with --watch flag.
      // Ensures changes in the sibling ../src/ directory trigger a rebuild.
      watch: {
        include: [
          'src/**',
          '../src/**'
        ]
      },
      sourcemap: true
    },

    // resolve.alias: only needed if using @cli/* path aliases in main process code.
    // If using direct relative imports (../../src/...), this section is optional.
    resolve: {
      alias: {
        '@cli': resolve(__dirname, '../src')
      }
    }
  },

  preload: {
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/preload.ts')
        }
      },
      sourcemap: true
      // externalizeDeps is true by default.
      // For a sandboxed preload that only uses contextBridge + ipcRenderer,
      // no changes are needed here.
      // If sandbox is disabled (sandbox: false in BrowserWindow), still no changes needed.
    }
  },

  renderer: {
    root: 'src/renderer',
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html')
        }
      }
    }
    // renderer uses Vite's standard web bundler.
    // Node.js modules are NOT available here by design.
    // resolve.alias for @renderer/* paths can be added here if needed.
  }
})
```

---

## Supporting Files

### `electron-ui/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "Node",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "sourceMap": true,
    "resolveJsonModule": true,
    "paths": {
      "@cli/*": ["../src/*"]
    }
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "out"]
}
```

**Why `CommonJS` and `Node` for electron-ui:**
- The electron-vite output for the main process is CJS
- Using `CommonJS` module mode means TypeScript does NOT require `.js` extensions in imports within `electron-ui/src/main/` — this avoids confusion
- The `../src/` files are NOT compiled by this `tsc` config — they are compiled by Rollup during the electron-vite build, using the root `tsconfig.json` (which correctly uses `NodeNext`)
- The `paths` entry (`@cli/*`) is for editor IntelliSense only; at build time, Rollup uses `resolve.alias` from the electron-vite config

### `electron-ui/package.json` (key fields)

```json
{
  "name": "geminirag-ui",
  "version": "1.0.0",
  "main": "out/main/index.js",
  "scripts": {
    "dev": "electron-vite dev --watch",
    "build": "electron-vite build",
    "preview": "electron-vite preview"
  },
  "devDependencies": {
    "electron": "^41.0.0",
    "electron-vite": "^5.0.0",
    "typescript": "^5.0.0",
    "@types/node": "^22.0.0",
    "react": "^18.0.0",
    "react-dom": "^18.0.0",
    "@types/react": "^18.0.0",
    "@types/react-dom": "^18.0.0"
  },
  "dependencies": {
    // Keep empty or minimal. The GeminiRAG service layer dependencies
    // (@google/genai, dotenv, etc.) will be bundled from the root node_modules.
    // Only add here if a specific package fails to bundle and must be externalized.
  }
}
```

Note: Do NOT set `"type": "module"` in `electron-ui/package.json`. The absence of this field means the package defaults to CJS, which is what electron-vite expects for a CJS main process output.

---

## Common Issues and Solutions

### Issue 1: Rollup Cannot Find Modules from `../src/`

**Symptom**: Build fails with `Could not resolve '../src/services/registry.js'`

**Cause**: The import path is relative to the file doing the import, but the file is inside `electron-ui/src/main/` — so the relative path needs to be `../../src/services/registry.js`, not `../src/services/registry.js`.

**Fix**: Use correct relative depth. Or use the `@cli` alias: `@cli/services/registry.js`.

### Issue 2: `ERR_REQUIRE_ESM` at Runtime

**Symptom**: App starts but crashes with `Error [ERR_REQUIRE_ESM]: require() of ES Module`

**Cause**: A dependency imported from `../src/` is an ESM-only package that Rollup externalized (e.g., it is listed in `electron-ui/package.json` dependencies and therefore not bundled).

**Fix**: Remove it from `electron-ui/package.json` dependencies (so it gets bundled from `node_modules/`) or add it to `externalizeDeps.exclude` to force bundling.

### Issue 3: Changes in `../src/` Not Triggering Rebuild

**Symptom**: During `electron-vite dev --watch`, editing files in `../src/` does not restart Electron.

**Cause**: The `build.watch.include` option is not configured, and the files are not in the Rollup module graph (because they are imported indirectly or not at all from the current entry point).

**Fix**: Add `'../src/**'` to `build.watch.include` as shown in the configuration above.

### Issue 4: `__dirname` Not Defined in Main Process

**Symptom**: Runtime error about `__dirname` being undefined.

**Cause**: The `electron-ui/package.json` was accidentally given `"type": "module"`, which makes Node.js treat `.js` output files as ESM. In ESM, `__dirname` is not available.

**Fix**: Remove `"type": "module"` from `electron-ui/package.json`. If the error persists, use `import.meta.dirname` (Node 21.2+) or the `fileURLToPath(import.meta.url)` pattern.

### Issue 5: TypeScript Errors in `main.ts` for Imports from `../src/`

**Symptom**: VSCode shows TypeScript errors for imports from `../src/` even though the build succeeds.

**Cause**: The `electron-ui/tsconfig.json` `paths` mapping (`@cli/*`) is not defined, or the IDE is not picking up the cross-project references.

**Fix**: Add `paths` to `electron-ui/tsconfig.json` as shown above. Also add `"references": [{ "path": "../tsconfig.json" }]` to give TypeScript the full picture of the sibling project. Note that TypeScript project references require composite mode in the referenced project, which may require changes to the root `tsconfig.json` — this is an editor-only concern and has no runtime impact.

---

## Assumptions and Scope

### What Was Confirmed

| Claim | Confidence | Source |
|-------|------------|--------|
| electron-vite v5 uses Rollup (not esbuild) for main process bundling | HIGH | Official docs + config schema |
| `build.rollupOptions.external` defaults include `electron` and all Node builtins | HIGH | Official config reference table |
| `ssr.noExternal: true` is always set, overriding normal SSR externalization | HIGH | Official config reference |
| `build.watch.include` accepts glob patterns including paths outside the project root | HIGH | Rollup WatcherOptions documentation |
| Rollup's TypeScript plugin resolves `.js` imports to `.ts` source files | HIGH | Rollup + community documentation |
| `build.externalizeDeps` replaces the deprecated `externalizeDepsPlugin` in v5 | HIGH | electron-vite v5 migration guide |
| `resolve.alias` must be defined per-process (main, preload, renderer) | HIGH | electron-vite community issues + docs |
| `electron-ui/package.json` must NOT have `"type":"module"` for CJS output | HIGH | electron-vite troubleshooting guide |

### Assumptions Made

| Assumption | Confidence | Impact if Wrong |
|------------|------------|-----------------|
| electron-vite v5 is the target version | HIGH | v4 uses different API (`externalizeDepsPlugin`) |
| The Electron version will be 28 or newer | MEDIUM | If older, ESM output format is unavailable (not relevant since we use CJS) |
| `@google/genai` can be bundled by Rollup without native bindings | MEDIUM | If it requires native bindings, mark it external and install in `electron-ui/package.json` |
| Direct relative imports (`../../src/`) will be used rather than aliases | MEDIUM | If aliases are used, the `resolve.alias` section becomes mandatory |
| The root GeminiRAG `node_modules/` is accessible from `electron-ui/` | HIGH | Node.js walks up the directory tree for module resolution; this is standard behavior |

### Out of Scope

- Production packaging (electron-builder, ASAR creation)
- V8 bytecode compilation for source protection
- Preload sandboxing configuration in detail
- Renderer-side Vite configuration beyond entry point

---

## References

| # | Source | URL | Information Gathered |
|---|--------|-----|---------------------|
| 1 | electron-vite Official Docs - Config Reference | https://electron-vite.org/config/ | Complete built-in config defaults table for main/preload/renderer |
| 2 | electron-vite Official Docs - Dependency Handling | https://electron-vite.org/guide/dependency-handling | externalizeDeps behavior, fully bundling, rollupOptions.external |
| 3 | electron-vite Official Docs - Troubleshooting | https://electron-vite.org/guide/troubleshooting | ERR_REQUIRE_ESM fix, CJS/ESM issues, migration notes |
| 4 | electron-vite Official Docs - HMR and Hot Reloading | https://electron-vite.org/guide/hmr-and-hot-reloading | Watch mode setup, CLI --watch flag, build.watch config |
| 5 | electron-vite Official Docs - Development | https://electron-vite.org/guide/dev | Project structure conventions, custom entry points, preload sandboxing |
| 6 | Rollup Configuration Options - watch | https://rollupjs.org/configuration-options/#watch | watch.include, watch.exclude, WatcherOptions schema |
| 7 | Vite Shared Options - resolve.alias | https://vitejs.dev/config/shared-options.html#resolve-alias | Alias ordering, array form, absolute path requirement |
| 8 | Context7 - electron-vite-docs | https://github.com/alex8088/electron-vite-docs | Complete documentation snippets for all config options |
| 9 | GitHub Discussion - Vite alias outside project root | https://github.com/vitejs/vite/discussions/14211 | How to alias imports from directories outside project root |
| 10 | GitHub Issue - electron-vite alias resolution for common folder | https://github.com/twstyled/electron-vite-react/issues/1 | Community confirmation of resolve.alias approach for sibling directories |
| 11 | npm - vite-tsconfig-paths | https://www.npmjs.com/package/vite-tsconfig-paths | Plugin for automatic tsconfig paths sync to Vite (alternative to manual alias) |

### Recommended for Deep Reading

- **electron-vite Config Reference** (source 1): The built-in defaults table is essential — it clarifies what electron-vite configures automatically vs. what requires explicit setup.
- **electron-vite Dependency Handling** (source 2): Critical for understanding the `externalizeDeps` behavior and the `exclude` list for bundling ESM-only packages.
- **Rollup WatcherOptions** (source 6): The `watch.include` option is not documented in electron-vite's own docs but is directly available via `build.watch`.

---

## Clarifying Questions for Follow-up

1. Will the main process source files use direct relative imports (`../../src/services/registry.js`) or an alias (`@cli/services/registry.js`)? The alias approach requires keeping `resolve.alias` and `tsconfig.json paths` in sync; the relative approach is simpler.

2. Are any of the packages used by `../src/` (e.g., `dotenv`, `@google/genai`) installed only in the root `node_modules/` or also planned for `electron-ui/node_modules/`? This determines whether they get bundled or externalized.

3. Will the preload script require `sandbox: false`, or will it operate in full sandbox mode? This affects whether `externalizeDeps: false` is needed for the preload build.

4. Should `vite-tsconfig-paths` be used instead of manual `resolve.alias`? This plugin reads `tsconfig.json` paths automatically and can eliminate the duplication, but it adds a dependency.
