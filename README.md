# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react/README.md) uses [Babel](https://babeljs.io/) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type aware lint rules:

- Configure the top-level `parserOptions` property like this:

```js
export default {
  // other rules...
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    project: ['./tsconfig.json', './tsconfig.node.json'],
    tsconfigRootDir: __dirname,
  },
}
```

- Replace `plugin:@typescript-eslint/recommended` to `plugin:@typescript-eslint/recommended-type-checked` or `plugin:@typescript-eslint/strict-type-checked`
- Optionally add `plugin:@typescript-eslint/stylistic-type-checked`
- Install [eslint-plugin-react](https://github.com/jsx-eslint/eslint-plugin-react) and add `plugin:react/recommended` & `plugin:react/jsx-runtime` to the `extends` list



## Package

in windows, launch git bash by using administrator user and then goto project directory and then execute the following command to package the project.
```bash
npm run package
```

## Deep Link 自动化支持

ShuTong 支持使用 `shutong://` 协议进行自动化控制，方便与其他工具（如 Raycast, Shortcuts, 脚本）集成。

**支持的命令：**
- `shutong://start-recording`：开始录制（Start Recording）
- `shutong://stop-recording`：停止录制（Stop Recording）

**使用示例：**

1. **Windows (CMD/PowerShell)**
   ```batch
   start shutong://start-recording
   start shutong://stop-recording
   ```

2. **macOS (Terminal)**
   ```bash
   open shutong://start-recording
   open shutong://stop-recording
   ```