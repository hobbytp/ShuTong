# Build Issue Resolution

## 问题描述
`npm install` 失败，报错：
1. `Could not find any Python installation`
2. `Could not find any Visual Studio installation`

## 根本原因
`package.json` 中的 `postinstall` 脚本使用了 `-f` 参数：

```json
"postinstall": "npm run rebuild"
"rebuild": "electron-rebuild -f -w better-sqlite3"
```

`-f` 参数会**强制从源码重新编译**，忽略预编译二进制文件，因此需要 VS Build Tools。

## 解决方案
1. **移除 `postinstall` 脚本** - 不再自动触发重新编译
2. **移除 `-f` 参数** - 尊重预编译二进制文件
3. **更新 `active-win` → `get-windows`** - 使用官方继任包

### 代码变更

**package.json:**
```diff
- "rebuild": "electron-rebuild -f -w better-sqlite3",
- "postinstall": "npm run rebuild",
+ "rebuild": "electron-rebuild -w better-sqlite3",
```

**electron/capture.ts:**
```diff
- const activeWinModule = await import('active-win');
+ const getWindowsModule = await import('get-windows');
```

## 验证结果
- ✅ `npm install` 成功完成
- ✅ `npm run dev` 启动应用
- ✅ 存储正常初始化
- ✅ 无需安装 VS Build Tools

## 经验总结

> **关键教训**: 原生模块（如 `better-sqlite3`）通常自带预编译二进制文件，除非有特殊需求，否则不要使用 `-f` 强制重新编译。

### 相关知识
- `electron-rebuild` 用于为 Electron 版本重新编译原生模块
- `-f` 参数强制从源码编译，需要 Python + VS Build Tools
- 没有 `-f` 时，会优先使用预编译二进制文件
- `npm install --ignore-scripts` 可以跳过 postinstall 脚本

### 未来遇到 `MODULE_NOT_FOUND` 错误
如果 `better-sqlite3` 出现模块找不到的错误，可能需要手动运行：
```bash
npm run rebuild
```
这会优先使用预编译二进制文件，只在必要时才编译。