# ShuTong 图标更新技术文档

本文档记录了将 ShuTong 应用图标从默认的 Electron 图标全面迁移为 `ShuTong.png` 造型的技术细节与步骤。

## 1. 资源准备与转换

为了在不同平台（尤其是 Windows 任务栏）上获得最佳显示效果，我们需要提供多种格式的图标。

- **原始资源**：`ShuTong.png` (位于项目根目录)
- **同步资源**：复制到了 `public/ShuTong.png`
- **生成 ICO**：为了解决 Windows 任务栏由于图标路径或格式导致的缓存不更新问题，我们将 PNG 转换为了原生支持更好的 `.ico` 格式。
  - **命令**：`npx -y png-to-ico ShuTong.png > public/icon.ico`
  - **结果**：生成了包含多个尺寸的 `public/icon.ico`。

## 2. 主进程配置 (`electron/main.ts`)

在 Electron 入口文件中进行了关键配置，以确保操作系统正确识别应用身份：

- **身份声明**：
  ```typescript
  app.name = 'ShuTong';
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.raytan.shutong');
  }
  ```
  *注：这能确保 Windows 将窗口、任务栏图标和通知正确关联。*

- **窗口图标逻辑**：
  ```typescript
  function createWindow() {
    // Windows 使用 .ico (兼容性更好)，其他平台使用 .png
    const iconFile = process.platform === 'win32' ? 'icon.ico' : 'ShuTong.png';
    const iconPath = path.join(process.env.VITE_PUBLIC, iconFile);
    
    win = new BrowserWindow({
      // ...
      icon: nativeImage.createFromPath(iconPath),
      // ...
    });
  }
  ```

## 3. 系统托盘更新 (`electron/tray.ts`)

- 更新了 `setupTray` 函数，将托盘图标指向新资源：
  ```typescript
  const iconPath = path.join(process.env.VITE_PUBLIC, 'ShuTong.png');
  const icon = nativeImage.createFromPath(iconPath);
  tray = new Tray(icon);
  ```

## 4. 隐藏服务窗口更新 (`electron/features/video/video.service.ts`)

为防止在 `Alt+Tab` 或任务视图中出现 Electron 默认图标，为隐藏的视频生成窗口也设置了图标：

- **配置**：在 `createVideoGenerationWindow` 中同样添加了 `icon: nativeImage.createFromPath(iconPath)` 属性。

## 5. 前端界面与 Web 标识

- **网页标识 (`index.html`)**：
  - 更新了 Favicon：`<link rel="icon" type="image/png" href="/ShuTong.png" />`
  - 更新了页面标题：`<title>ShuTong - AI screen assistant</title>`

- **侧边栏 Logo (`src/components/Shell/Sidebar.tsx`)**：
  - 在侧边栏顶部插入了品牌 Logo：
    ```tsx
    <div className="mb-4">
        <img src="/ShuTong.png" alt="ShuTong" className="w-10 h-10 rounded-xl shadow-lg ring-1 ring-white/10" />
    </div>
    ```

## 6. Windows 任务栏更新指南

如果代码更新后任务栏图标仍未改变，通常是由于 Windows 图标缓存导致。建议采取以下措施：

1. **重新固定**：右键点击任务栏旧图标 -> 取消固定。重新运行程序后，再次固定新图标。
2. **清除系统图标缓存**：
   ```bash
   ie4uinit.exe -show
   ```
3. **重启资源管理器**：在任务管理器中重启 `explorer.exe`。
