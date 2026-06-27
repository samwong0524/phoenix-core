---
name: electron-frontend-reverse-analysis
description: Techniques for analyzing Electron frontend code, extracting node types, and mapping APIs from minified bundles.
auto-load: true
metadata:
  roles: [程序员-李娜]
---
# Electron Frontend Reverse Analysis

## Context
When analyzing Electron apps with packed/obfuscated frontends (e.g., using Vite, React, minified bundles) like LOStudio.

## Key Steps

### 1. Locate Entry Points
- Check `dist/index.html` for script tags: `<script type="module" crossorigin src="/assets/index-*.js">`.
- Check `importmap` in HTML to identify frameworks (React, Vue, etc.) and versions.

### 2. Extract Component/Node Types
- In ReactFlow or similar node-based apps, node types are registered in an object.
- Use grep to find strings ending in "Node" or similar patterns.
  ```bash
  # Find potential node type names
  grep -oP '"[a-zA-Z]*Node"' dist/assets/index-*.js | sort | uniq -c | sort -rn
  ```
- Look for registration blocks: `const nodeTypes = { ... }`.

### 3. Map API Endpoints
- Search for fetch calls or URL strings.
  ```bash
  # Find API paths
  grep -oP '"/api/[^"]*"' dist/assets/index-*.js | sort | uniq
  
  # Find external domains
  grep -oP '"https://[^"]*"' dist/assets/index-*.js | sort | uniq
  ```
- Contextualize endpoints by grabbing surrounding text:
  ```bash
  grep -oP '.{0,50}"/api/jimeng".{0,50}' dist/assets/index-*.js
  ```

### 4. Analyze Assets
- Check `dist/assets/` for large files:
  - `.wasm`: WebAssembly modules (likely AI models like ONNX).
  - `.css`: Styling (Tailwind, CSS-in-JS).
  - `.mjs`: ESM modules.

### 5. Deobfuscation Tips
- Use `grep` with PCRE (`-P`) for regex.
- Use `head -c 2000` to inspect file headers (Webpack/Vite signatures).
- Look for readable strings inside the binary blob.