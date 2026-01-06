# Lesson & Learn: Startup & Build Optimization

## 1. Electron White Flash
**Issue**: Application showed a white rectangle for ~500ms before loading content.
**Cause**: Calling `win.show()` immediately after `new BrowserWindow()` but before the renderer had painted the first frame.
**Fix**:
*   Use `show: false` in constructor.
*   Wait for `ready-to-show` event before calling `win.show()`.

## 2. React Hydration Race Condition
**Issue**: The app stuck on "INITIALIZING..." because the `READY` event from Electron was sent *before* the React component had mounted and set up the listener.
**Fix**: "Pull" architecture.
*   React component calls `ipcRenderer.invoke('get-app-lifecycle')` inside `useEffect` on mount to get the *current* state, in addition to listening for future updates.

## 3. Production Asset Paths (file:// Protocol)
**Issue**: Images and Locales failed to load in the built `.exe`.
*   `img src="/ShuTong.png"` resolved to `F:/ShuTong.png` (Root of drive) instead of resources.
*   `i18next-http-backend` tried to `fetch('/locales/...')` which fails on local file protocol.
**Fix**:
*   **Images**: Move to `src/assets` and use `import logo from '...'`. Vite bundles this and handles the path.
*   **Locales**: Use `import.meta.glob('../public/locales/**/*.json', { eager: true })` to bundle all translation JSONs into the JavaScript bundle. Pass them directly to `resources` in i18next init.

## 4. Transparent Window Constraints
**Issue**: Setting `transparent: true` didn't work initially.
**Fix**: Must strictly remove `backgroundColor` property from BrowserWindow config. If `backgroundColor` is present, transparency is disabled on Windows.

## 5. File Locking during Build
**Issue**: `npm run build` failed with `Access is denied` for `d3dcompiler_47.dll`.
**Cause**: The previous instance of `ShuTong.exe` was still running (even if window was closed, background processes remained).
**Fix**: Ensure `taskkill /F /IM ShuTong.exe` is run before rebuilding.
