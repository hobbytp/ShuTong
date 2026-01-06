PRD 审查报告 - Project Insight (Pulse)
总体而言，这是一份结构清晰、愿景明确的 PRD。以下是我发现的问题和改进建议：

🔴 关键遗漏 (Critical Gaps)
1. 缺少与现有 ShuTong 功能的整合说明
ShuTong 已有以下核心功能，PRD 未明确如何与它们整合：

屏幕录制 & Timelapse 回放 - 这是 ShuTong 的核心数据来源
Timeline Cards (时间线卡片) - 现有的 AI 分析结果结构
Journal 日记功能 - 已有的 intention/reflection 系统
现有的 LLM 分析管道 (
analysis.ts
 + LLMService)
建议补充：

markdown
### 1.3 与现有 ShuTong 功能的关系a
- **数据源整合:** Pulse 卡片将复用 ShuTong 已有的 Timeline Cards 和 Journal Entries 作为输入源
- **组件复用:** L2 对话界面需与现有的 AI 配置 (llm_config.json) 兼容
- **路由设计:** Pulse 将作为新的顶级页面 (/pulse) 加入现有路由
2. 缺少数据存储方案
PRD 定义了 PulseCard 接口，但未说明：

使用现有的 better-sqlite3 还是新建表？
与现有 timeline_cards 表的关系？
卡片归档后的存储策略？
建议补充第 5.4 节：数据存储设计

3. 后端触发机制不完整
PRD 提到 "Cron Job @ 4:00 AM"，但：

ShuTong 是 Electron 桌面应用，不是服务端应用
用户电脑可能在凌晨关机
现有的 
scheduler.ts
 只支持简单的提醒通知
建议改进：

markdown
### 5.4 触发策略 (考虑桌面应用场景)
- **Primary:** 用户首次打开 App 时检查并触发生成
- **Secondary:** 后台保活时按计划时间触发
- **Fallback:** 若超过 24 小时未生成，首次打开时即时生成
🟡 需要澄清的问题 (Ambiguities)
问题	当前描述	建议
外部数据源	提到 Google Calendar/Gmail	ShuTong 目前无 OAuth 集成，需明确是否在 v0.1 范围内
L2 对话模型	未指定	应复用 
llm_config.json
 中已配置的模型？还是 Pulse 专用模型？
"发芽卡"的"旧笔记"	来源不明	应明确指 ShuTong 的 Journal entries 还是 Timeline Cards？
"实时搜索"	Briefing 卡片的触发源	是否需要联网搜索？涉及隐私考量
🟢 改进建议 (Suggestions)
1. 技术架构节建议更具体
现有前端使用 React + TailwindCSS + Vite，建议：

markdown
### 5.2 前端组件架构 (与现有代码对齐)
- 新建 `src/pages/Pulse.tsx` 作为主页面
- 卡片组件放置于 `src/components/Pulse/` 目录
- 复用现有 `src/components/ui/` 中的基础组件 (Button, Card 等)
2. 补充 IPC 通信设计
ShuTong 的 Electron + React 架构依赖 IPC 通道，建议补充：

markdown
### 5.5 IPC 通道设计
| Channel | Direction | 用途 |
|---------|-----------|------|
| `pulse:fetch-cards` | Renderer → Main | 获取当日卡片列表 |
| `pulse:update-status` | Renderer → Main | 更新卡片状态 (read/saved) |
| `pulse:submit-feedback` | Renderer → Main | 提交赞/踩反馈 |
| `pulse:trigger-generation` | Renderer → Main | 手动触发卡片生成 |
3. MVP 范围建议收窄
建议 v0.1 MVP 先聚焦核心价值：

markdown
## Phase 0.1 (MVP) 范围建议
✅ 包含:
- Sprouting (发芽卡) - 基于现有 Timeline/Journal 数据
- Meta (策划卡) - 反馈入口
- 基本 L1 浏览 + 状态管理
❌ 延后:
- Briefing (需联网搜索)
- Action (需 Calendar/Gmail OAuth)
- Challenge (需复杂行为分析)
📝 格式/文档问题
5.2 节的 JSX 代码有转义问题 - <App\> 应为 <App>
4.2 节表格中的 $$核心创新$$ - LaTeX 语法在 Markdown 中可能渲染异常
版本号建议改为 0.1.0-draft - 表明仍在评审阶段
建议补充词汇表 (Glossary) - 解释 L1/L2、Pulse 等术语
总结
类别	数量
🔴 关键遗漏	3
🟡 需澄清	4
🟢 改进建议	3
📝 格式问题	4
最重要的下一步： 补充与现有 ShuTong 架构的整合设计，特别是数据存储和 IPC 通信部分，这将直接影响开发工作量评估。

需要我帮您将这些建议直接整合到 PRD 文件中吗？

