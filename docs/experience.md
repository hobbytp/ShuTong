## Vibe Coding的教训

Antigravity：
不断提醒要遵循TDD。
每开发一段时间（比如3个phases）后，提醒总结之前遇到的问题和解决方案，它会写入一个lesson_and_learn的文档里。
```
总结之前遇到的问题和解决方案，写入lesson_and_learn.md文件。
```

不会自动解决linter的问题。

### Prompt
```
重新审视刚才修改的代码，看看有没有什么错漏之处和待改进之处。
```

gemini flash生成的代码，最好让gemini pro用上面的prompt检查一遍


我们的程序需要同时支持macOS和Windows，并严格遵循TDD的开发原则。

UI的不同页面，在开发过程中可能会使用不同风格，这个需要在某个时期进行统一。比如刚开始，没有强制要求统一风格，后面再UI 重构的情况下，统一使用了 Zinc Theme 的风格。

## antigravity 相关
AI会帮助我生成一些plan，task，review，lesson_and_learn等文件。但是考虑的AI会在不同的session间切换它内部的目录，所以显示让AI把这些信息写到本地docs文件夹里能更容易沉淀下来（比如lesson and learn）

## Electron相关
普通浏览器（Chrome/Edge 等）打开 http://localhost:5173 时，是无法直接访问 Electron 主进程（后端）的。原因如下：

沙箱隔离：普通网页运行在浏览器的安全沙箱中，无法直接调用 Node.js API（如 fs, child_process），也无法访问 Electron 特有的 ipcRenderer。
IPC 通信机制：Electron 的 IPC（进程间通信）依赖于 Chromium 的特定 C++ 绑定，这些绑定只在 Electron 封装的 BrowserWindow 中存在，普通浏览器没有这些底层管道。

### UI Refactor Lessons (Phase 10)
**1. Flexbox 滚动条失效 (Missing Scrollbars)**
*   **现象**：在 Flex Column 布局中，即便子元素设置了 `overflow-auto`，内容依然撑开整个页面且不出现滚动条，导致底部内容被裁切。
*   **原因**：Flex items 默认的 `min-height` 是 `auto` (即内容高度)。如果父容器没有显式限制，它会无限通过内容撑开。
*   **解法**：在 Flex 容器（Wrapper）上添加 `min-h-0` (即 `min-height: 0`)。这会强制 Flexbox 重新计算剩余空间，从而让内部的 `overflow-auto` 生效。

**2. 侧边栏 Tooltip 被裁切**
*   **现象**：侧边栏为了支持小屏幕滚动，加上了 `overflow-y-auto`。结果导致 absolute 定位的 Tooltip 如果超出侧边栏宽度，就会被裁切不可见。
*   **解法**：使用 **React Portal** (`createPortal`)。将 Tooltip 直接渲染到 `document.body` 层级，并通过 `getBoundingClientRect` 计算坐标。这样 Tooltip 在 DOM 结构上脱离了侧边栏的 overflow 上下文。

**3. 布局抖动 (Layout Jitter)**
*   **现象**：点击侧边栏按钮时，底部的 Settings 图标出现细微跳动。
*   **原因**：Active 状态使用了 `font-weight: medium` (比 normal 宽) 或 `border` 变化，导致盒模型尺寸微调，进而推挤了 Flex 容器内其他元素。
*   **解法**：保持 Active/Inactive 状态的 **布局尺寸一致**。避免切换字体粗细，或使用 `flex-shrink-0` 强制固定无关元素，或使用 `ring` (box-shadow) 代替 `border`。

**4. 依赖库版本差异 (Zod v3 vs v4)**
*   **现象**：`z.record(Schema)` 报错。
*   **原因**：Zod v4 改变了 API 签名，`z.record` 必须显式指定 Key 的 Schema，即 `z.record(z.string(), ValueSchema)`。
*   **Lesson**：升级大版本依赖时，务必查阅 BREAKING CHANGES。