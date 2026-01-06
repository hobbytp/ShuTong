# Better-SQLite3 Electron 原生模块编译问题

## 问题描述

运行 `npm run dev` 时，应用启动失败，报错：

```
Error: The module '...\better-sqlite3\build\Release\better_sqlite3.node'
was compiled against a different Node.js version using
NODE_MODULE_VERSION 137. This version of Node.js requires
NODE_MODULE_VERSION 140.
```

## 根因分析

1. **版本不匹配**：`better-sqlite3` 是原生 Node.js 模块，需要针对特定的 Node.js ABI 版本编译
2. **Electron vs Node.js**：Electron 39 使用 Node.js v22（ABI 140），但 `npm rebuild` 使用系统 Node.js 编译（ABI 137）
3. **传统方式失效**：
   - `npm config set python` 在 npm 10+ 已被废弃
   - `.npmrc` 中的 `python=` 配置已失效
   - `npm_config_python` 环境变量在下个版本会失效

## 解决方案

### 方法一：使用预编译二进制（推荐）

无需 Python，直接下载适配 Electron 的预编译二进制：

```bash
cd node_modules/better-sqlite3 && npx prebuild-install --runtime=electron --target=39.2.7
```

### 方法二：使用 electron-rebuild（需要 Python）

```bash
npm run rebuild
# 等价于：electron-rebuild -w better-sqlite3
```

需要：
- Python 3.10+（可用项目中的 `.venv`）
- Visual C++ Build Tools

### 自动化建议

在 `package.json` 中添加 postinstall 脚本：

```json
{
  "scripts": {
    "postinstall": "cd node_modules/better-sqlite3 && npx prebuild-install --runtime=electron --target=39.2.7 || true"
  }
}
```

## 关键知识点

| 方式 | 状态 | 备注 |
|------|------|------|
| `npm config set python` | ❌ 已废弃 | npm 10+ 不再支持 |
| `.npmrc` python 配置 | ❌ 已废弃 | 不再生效 |
| `NODE_GYP_FORCE_PYTHON` | ✅ 可用 | 环境变量方式 |
| `npx prebuild-install` | ✅ 推荐 | 无需编译工具链 |

## 参考

- [better-sqlite3 文档](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/troubleshooting.md)
- [node-gyp 官方说明](https://github.com/nodejs/node-gyp#on-windows)
