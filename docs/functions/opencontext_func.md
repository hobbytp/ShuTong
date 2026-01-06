📘 OpenContext 功能描述文档
1. 项目概述
OpenContext 是一个智能上下文管理系统，通过捕获用户的屏幕截图、文档、网页链接等多种数据源，利用大语言模型（LLM）进行智能分析和处理，为用户提供活动摘要、智能提醒、待办事项管理以及智能问答等功能。

1.1 核心能力
能力领域	功能描述
上下文捕获	自动截屏、文件夹监控、文档导入、网页链接采集
智能处理	VLM 图像理解、文档解析、实体提取、语义分类
向量存储	基于 ChromaDB/Qdrant/LanceDB 的语义检索
内容生成	日报生成、活动摘要、智能提醒、待办识别
智能问答	Agent 驱动的多轮对话、上下文感知回答
2. 功能模块详解
2.1 上下文捕获模块 (context_capture/)
2.1.1 截图捕获 (screenshot.py)
功能: 定时自动截取屏幕内容
配置项:
capture_interval: 截图间隔（默认 5 秒）
storage_path: 截图存储目录
输出: RawContextProperties 对象，包含图像路径和时间戳
2.1.2 文件夹监控 (folder_monitor.py)
功能: 监控指定文件夹的文件变化
支持: 新增、修改、删除事件检测
配置项:
watch_folder_paths: 监控目录列表
recursive: 是否递归监控子目录
max_file_size: 最大处理文件大小
2.1.3 Vault 文档监控 (vault_document_monitor.py)
功能: 监控用户文档库的变化
特点: 支持增量扫描和初始化扫描
2.1.4 网页链接采集 (weblink.py)
功能: 抓取和解析网页内容
输出: 提取的文本内容和元数据
2.2 上下文处理模块 (context_processing/)
2.2.1 截图处理器 (screenshot_processor.py)
核心功能:
pHash 去重：避免处理相似图像
VLM 图像理解：提取屏幕内容语义
批量处理：支持多图同时分析
处理流程:
关键参数:
similarity_hash_threshold: 相似度阈值（默认 7）
batch_size: 批处理大小（默认 20）
max_image_size: 最大图像尺寸（默认 1920px）
2.2.2 文档处理器 (document_processor.py)
支持格式: PDF, DOCX, XLSX, CSV, Markdown, 图片
核心能力:
PDF 转图像处理
结构化文档分块
扫描件 OCR 识别
FAQ 结构提取
分块器类型:
DocumentTextChunker: 通用文本分块
StructuredFileChunker: 结构化文件分块
FAQChunker: FAQ 格式分块
2.2.3 上下文合并器 (context_merger.py)
功能: 合并相似上下文，减少冗余
策略: 基于向量相似度的智能合并
2.3 存储模块 (storage/)
2.3.1 向量存储 (IVectorStorageBackend)
后端	特点
ChromaDB	默认后端，本地持久化，按 context_type 分 collection
Qdrant	高性能向量数据库，支持分布式
LanceDB	列式存储，适合大规模数据
核心操作:

upsert_processed_context(): 插入/更新上下文
search(): 语义相似度搜索
get_all_processed_contexts(): 按条件检索
2.3.2 文档存储 (SQLiteBackend)
数据表结构:

表名	用途
vaults	用户文档、日报存储
todo	待办事项
activity	活动记录
tips	智能提醒
conversations	对话会话
messages	对话消息
monitoring_*	监控统计数据
2.4 LLM 客户端模块 (llm/)
2.4.1 VLM 客户端 (global_vlm_client.py)
功能: 视觉语言模型调用
支持: OpenAI API 兼容格式（含豆包等国产模型）
特性:
工具调用（Tool Calling）支持
流式输出
多轮工具调用循环（最大 5 次）
2.4.2 Embedding 客户端 (global_embedding_client.py)
功能: 文本向量化
接口:
do_embedding(text): 单文本向量化
do_vectorize(Vectorize): 结构化向量化
do_vectorize_async(): 异步向量化
2.5 工具系统 (tools/)
2.5.1 上下文检索工具
工具名	功能	数据源
ActivityContextTool	检索活动上下文	ChromaDB
IntentContextTool	检索意图上下文	ChromaDB
SemanticContextTool	语义相似度检索	ChromaDB
ProceduralContextTool	流程性上下文检索	ChromaDB
StateContextTool	状态上下文检索	ChromaDB
2.5.2 文档检索工具
工具名	功能	数据源
GetDailyReportsTool	获取日报	SQLite
GetActivitiesTool	获取活动记录	SQLite
GetTipsTool	获取智能提醒	SQLite
GetTodosTool	获取待办事项	SQLite
2.5.3 辅助工具
工具名	功能
ProfileEntityTool	实体画像/归一化
WebSearchTool	网络搜索
2.6 智能 Agent 模块 (context_consumption/context_agent/)
2.6.1 工作流引擎 (WorkflowEngine)
四阶段处理流程:

2.6.2 意图分析节点 (IntentNode)
查询分类:
SIMPLE_CHAT: 简单闲聊，直接回复
QA_ANALYSIS: 问答分析，需要上下文
CONTENT_GENERATION: 内容生成
DOCUMENT_EDIT: 文档编辑
实体增强: 通过 ProfileEntityTool 进行实体归一化
2.6.3 上下文收集节点 (ContextNode)
LLM 驱动的迭代收集:
最大迭代次数: 2 轮
工具并行执行
充分性评估: SUFFICIENT / PARTIAL / INSUFFICIENT
2.6.4 执行节点 (ExecutorNode)
动作类型:
GENERATE: 内容生成
EDIT: 文档编辑
ANSWER: 问题回答
流式输出: 通过 StreamEvent 实时推送结果
2.7 内容生成模块 (context_consumption/generation/)
2.7.1 日报生成 (ReportGenerator)
策略模式:
HourlyChunkingReportGenerator: 按小时分块生成
LongContextReportGenerator: 长上下文一次性生成
输出: Markdown 格式日报，自动存入 Vault
2.7.2 实时活动监控 (RealtimeActivityMonitor)
功能: 生成时间段内的活动摘要
输出: 活动标题、描述、类别分布、关键实体
2.7.3 智能提醒 (SmartTipGenerator)
功能: 基于活动模式生成个性化提醒
去重: 避免与最近提醒重复
2.7.4 待办管理 (SmartTodoManager)
功能: 从活动上下文中识别待办事项
去重: 基于向量相似度的待办去重
属性: 优先级、截止时间、参与者
2.8 服务接口 (server/)
2.8.1 API 路由
路由模块	功能
health	健康检查
agent_chat	Agent 对话接口
completions	智能补全
context	上下文管理
vaults	文档管理
events	事件推送
settings	配置管理
monitoring	监控统计
2.8.2 事件系统 (EventManager)
事件类型:
TIP_GENERATED: 提醒生成
TODO_GENERATED: 待办生成
ACTIVITY_GENERATED: 活动生成
DAILY_SUMMARY_GENERATED: 日报生成
机制: 缓存队列 + 拉取清空模式
2.9 管理器模块 (managers/)
2.9.1 捕获管理器 (CaptureManager)
注册/启动/停止捕获组件
回调机制通知数据到达
2.9.2 处理器管理器 (ProcessorManager)
路由表: ContextSource → Processor
线程池批量处理
2.9.3 消费管理器 (ConsumptionManager)
定时任务调度:
活动摘要: 15 分钟
智能提醒: 60 分钟
待办识别: 30 分钟
日报生成: 每日定时
3. 数据模型
3.1 核心数据结构
3.2 上下文类型枚举
类型	描述
ENTITY_CONTEXT	实体信息（人、组织、产品等）
ACTIVITY_CONTEXT	用户活动记录
INTENT_CONTEXT	意图和目标
SEMANTIC_CONTEXT	语义知识
PROCEDURAL_CONTEXT	操作流程
STATE_CONTEXT	状态信息
KNOWLEDGE_CONTEXT	知识内容
4. 配置说明
4.1 主配置文件 (config.yaml)
4.2 用户设置 (user_setting.yaml)
API 密钥覆盖
个人偏好设置