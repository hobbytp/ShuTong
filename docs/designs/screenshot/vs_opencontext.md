# ShuTong vs MiniContext: 深度对比与进阶改进方案

本文档基于对 MiniContext (OpenContext) 的深入分析，结合业界最佳实践，提出 ShuTong 在 Timeline 系统上的差异化优势与进阶改进方案。我们的目标不是简单复制，而是利用 ShuTong 的桌面端优势（Electron/Node.js）实现更高效、更精准、更隐私的上下文感知。

## 1. 视觉去重 (Visual Deduplication): 从 "全局哈希" 到 "混合智能去重"

### MiniContext 方案
*   **机制**: 全局 pHash + 海明距离 + LRU 缓存池。
*   **局限**:
    *   **对 "假性变化" 敏感**: 网页侧边的动态广告、系统右下角的通知弹窗、时钟的分钟跳动，都会导致 pHash 变化，从而产生冗余帧。
    *   **对 "焦点不变" 无感**: 用户正在专注写文档（焦点窗口），背景中播放的视频一直在动。MiniContext 会认为是新内容，但对"工作上下文"而言，这是冗余的。

### ShuTong 进阶方案: Hybrid Smart Dedup
利用 Electron 可以获取窗口层级和坐标的优势，实施**基于权重的混合去重**。

#### 1. Level 1: 焦点区域加权 (ROI-Weighted Hash) - 核心实现
*   **原理**: 传统的 pHash 是对全图生成指纹。改进版将图像分为 `Active Window` 和 `Background` 两部分。
*   **实现步骤**:
    1.  调用 `active-win` 或原生 API 获取当前激活窗口的 `bounds {x, y, width, height}`。
    2.  利用 Electron `nativeImage` 将截图裁剪为两部分：`img_active` 和 `img_bg`。
    3.  分别计算 pHash: `hash_active` 和 `hash_bg`。
    4.  计算上一帧的对应 Hash，得出变化距离 `dist_active` 和 `dist_bg`。
    5.  **加权公式**: `Final_Score = (dist_active * 0.8) + (dist_bg * 0.2)`。
    6.  **阈值判定**: 仅当 `Final_Score > Threshold` 时才触发后续流程。
*   **优势**: 即使背景电影在播放（`dist_bg` 很大），只要代码窗口没动（`dist_active` 接近 0），`Final_Score` 仍会很低，从而避免无效截图。
*   **注意**: 
    *   **Monitor Mode (全屏模式)**: ROI 策略至关重要，是区分噪音（背景）与信号（窗口）的核心。
    *   **Active Window Mode (窗口模式)**: 虽然本身已无背景，但 ROI 策略可演进为 **UI 区域加权**（例如：忽略 IDE 的侧边栏文件树变化，只关注代码编辑区变化），进一步提升去重精度。

#### 2. Level 2: 语义辅助去重 (Semantic Check)
*   **场景**: 网页浏览、文档阅读。用户可能只是滚动了几行，视觉上像素变化很大，但内容重复率高。
*   **实现步骤**:
    1.  当 Level 1 判定为"变化"时，不立即保存。
    2.  调用 `OCR Service` (Paddle/Tesseract) 提取当前帧文本 `text_curr`。
    3.  计算与上一关键帧文本 `text_prev` 的 **Jaccard Similarity** (交集/并集)。
    4.  **判定**: 若相似度 > 0.85 (即85%的内容是重叠的)，视为"滚动冗余"，丢弃该帧，仅更新上一帧的 `endTime`。

#### 3. Level 3: 输入驱动采样 (Input-Driven Sampling)
*   **策略**: 监听全局输入事件（需引入 `iohook` 或类似原生模块，注意隐私，仅统计频率）。
*   **状态机**:
    *   **Idle State**: 输入频率 < 5 ops/min -> 采样间隔 30s。
    *   **Active State**: 输入频率 > 30 ops/min -> 采样间隔 5s。
    *   **Burst State**: 连续快速输入后突然停止（可能在思考或报错） -> 立即触发一次截图。

## 2. 图像预处理 (Pre-processing): 从 "简单缩放" 到 "智能构图 (Smart Composition)"

### MiniContext 方案
*   **机制**: 整体等比缩放至长边 2048px。
*   **局限**:
    *   **高分屏灾难**: 在 4K 屏幕下，全屏缩放会导致小字号文本（如代码、终端日志）模糊不可读，严重影响 OCR 和 LLM 的理解能力。
    *   **Token 浪费**: 画面中 80% 的区域可能是无用的壁纸或非活动窗口。

### ShuTong 进阶方案: Smart ROI Composition
LLM 对图像分辨率敏感，且 Token 昂贵。我们应只喂给它"最有营养"的像素。

#### 方案 A: 焦点拼接 (Focus Stacking) - 推荐
*   **目的**: 既要看清细节（激活窗口），又要知道上下文（全屏概览）。
*   **实现逻辑**:
    1.  **获取原图**: 截取全屏 (e.g., 3840x2160)。
    2.  **裁剪焦点**: 根据激活窗口坐标，裁剪出 `ROI_Image` (e.g., 1920x1080)，保持 **100% 原始分辨率**。
    3.  **生成概览**: 将全屏图缩放为 `Context_Image` (e.g., 1024x576)，作为背景参考。
    4.  **垂直拼接**: 利用 `sharp` 或 `canvas` 将两图垂直拼接。
        *   Top: `Context_Image` (Label: "Full Screen Context")
        *   Bottom: `ROI_Image` (Label: "Active Window Detail")
    5.  **Prompt 引导**: "The top image is the low-res context. The bottom image is the high-res active window. Use the bottom image for reading text/code, and top image for understanding the environment."

#### 方案 B: 动态分辨率 (Dynamic Resolution)
*   **Coding 模式**: 检测到 IDE (VSCode, JetBrains)，强制保持高分辨率或采用分块切图 (Tile Slicing)，确保 OCR 准确率。
*   **Video 模式**: 检测到 Player/Browser 正在播放视频，自动降级分辨率至 720p，节省存储和 Token。

## 3. 视觉理解 (Visual Understanding): 从 "静态模板" 到 "自适应提示 (Context-Adaptive Prompting)"

### MiniContext 方案
*   **机制**: 固定的一套结构化 Prompt (Active/Semantic/State/Intent)。
*   **局限**: "一刀切"。用分析代码的 Prompt 去分析 "看电影"，或者用分析文档的 Prompt 去分析 "玩游戏"，效果都不是最优。

### ShuTong 进阶方案: Dynamic Prompt Injection - 已实现
利用本地获取的元数据（应用名、窗口标题、时间），在发送给 LLM 之前动态组装 Prompt。

#### 1. 动态模板库 (Template Registry)
已在 `prompts.ts` 中实现 `SCENARIO_PROMPTS` 映射表，支持 `coding`, `research`, `communication` 等场景。

#### 2. 注入逻辑
*   **前置判断 (Pre-classification)**:
    *   利用 `context-parser.ts` 中的 `parseWindowContext` 解析窗口标题，确定 `ActivityType`。
*   **运行时组装**:
    *   在 `analysis.service.ts` 中，根据 Batch 的 Context 调用 `getPromptForContext` 生成专用 Prompt。
    *   将生成的 Prompt 传递给 `LLMService.transcribeBatch`。
*   **状态**: 已完全实现并集成。

#### 3. 连续性注入 (Continuity Injection)
*   **上下文记忆**: 缓存上一帧的 `AnalysisResult`。
*   **增量提示**:
    *   "Previous Activity: 'Debugging login issue in auth.ts'."
    *   "Current Task: Is the user still working on this? If yes, what progress has been made? If no, what is the new context?"

## 4. 存储与隐私 (Storage & Privacy): 从 "事后删除" 到 "内存流式处理"

### MiniContext 方案
*   **机制**: 落盘 -> 分析 -> (可选)删除。
*   **局限**: 敏感图片（如网银界面、私人聊天）虽然被删除了，但曾短暂存在于硬盘上，有被恢复的风险。

### ShuTong 进阶方案: Secure Ephemeral Pipeline

#### 1. 内存流式架构 (In-Memory Stream)
*   **流程**:
    `Screenshot (Buffer) -> Smart Dedup (Memory) -> Resize/Crop (Buffer) -> LLM Analysis (Base64) -> Vector DB`
*   **关键点**:
    *   全链路不调用 `fs.writeFile` 保存图片文件。
    *   仅在 `LLM Analysis` 完成并提取出结构化数据（Summary, Keywords）后，才将**文本数据**落盘。
    *   图片 Buffer 在函数执行完后立即被 GC 回收。

#### 2. 敏感词黑名单 (Sensitive Blacklist)
*   **标题监控**: 实时监控窗口标题。
    *   `if (title.match(/password|login|bank|private/i))` -> **立即中止截图** 或 **开启隐私模式**。
*   **隐私模式 (Privacy Mode)**:
    *   仅记录应用名称和时长 (e.g., "User used Banking App for 5 mins")。
    *   不截图，不进行 OCR，不发送给 LLM。

#### 3. 本地加密 (Local Encryption)
*   如果用户选择开启"截图回溯"功能（即必须保存图片），则必须使用 AES-256 对图片文件进行加密存储，密钥由用户主密码派生，确保即使文件被盗也无法查看。

## 总结

| 维度 | MiniContext (现状) | ShuTong (进阶目标) | 核心优势 |
| :--- | :--- | :--- | :--- |
| **去重** | 全局 pHash | **ROI 权重 + 语义去重 + 输入驱动** | 专注工作区，忽略背景干扰 |
| **预处理** | 整体缩放 | **智能裁剪 (Smart ROI)** | 保证小字清晰，节省 Token |
| **提示词** | 静态结构化 | **动态自适应 (Adaptive)** | 专人专事，分析更深度 |
| **隐私** | 落盘后删 | **内存流式 (Ephemeral)** | 物理上更安全 |

通过这些改进，ShuTong 将从一个简单的 "截图记录器" 进化为一个 "懂你焦点的智能助手"。
