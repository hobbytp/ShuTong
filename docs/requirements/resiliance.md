# ShuTong 健壮性需求

## Graceful Shutdown
目前关闭太快，不知道是否需要 graceful shutdown。

---

## 内存管理 (P0 - Critical)

### 问题描述
2026-01-03 发现应用长时间运行后崩溃：
```
memory allocation of 5242880 bytes failed
```

### 触发条件
- 长时间运行 (30+ 分钟)
- 频繁窗口切换产生大量截图
- 多个 Batch 同时处理
- OCR + Video 生成 + Vector 索引并发运行

### 日志特征
- `[OCRService] Extracted 8193 chars` - 大量 OCR 文本
- 多个 `[Video] Starting video generation` 同时运行
- `[VectorStorage] Added activity` 频繁更新

### 潜在内存泄漏点
1. **PaddleOCR WebGL 上下文** - GPU 内存未释放
2. **Video 生成窗口** - 隐藏窗口累积
3. **Screenshot Buffer** - 截图缓冲区未回收
4. **LanceDB 向量索引** - 频繁写入

### 建议解决方案

#### 短期 (Quick Fix)
- [ ] 添加 `--max-old-space-size=4096` 到 Electron 启动参数
- [ ] 限制并发 Video 生成任务数量 (最多 3 个)
- [ ] 定期强制 GC: `global.gc()` (需要 `--expose-gc`)

#### 中期 (Proper Fix)
- [ ] 实现 Video 生成队列 (而不是并发)
- [ ] PaddleOCR 空闲超时后释放 WebGL 上下文
- [ ] 添加内存监控和告警

#### 长期 (Architecture)
- [ ] 将 Video 生成移到独立进程
- [ ] 实现背压 (Backpressure) 机制
- [ ] 添加进程健康检查和自动重启

### 监控指标
- `process.memoryUsage().heapUsed`
- `process.memoryUsage().external`
- GPU 内存使用量

---

## 并发控制

### 问题
目前 Analysis Service 处理多个 Batch 时，可能同时触发：
- 3x OCR 请求
- 1x LLM Transcribe
- 1x LLM GenerateCards
- 1x Video Generation
- 1x Vector Insert

### 建议
- OCR: 限制并发为 1
- Video: 限制并发为 2
- LLM: 使用现有的 rate limiting

---

## 进程隔离

### 当前状态
- 主进程: Electron Main
- 渲染进程: Main Window
- 隐藏进程: Video Generator Window
- 隐藏进程: PaddleOCR Worker Window

### 风险
任一隐藏进程崩溃可能影响主应用。

### 建议
- [ ] 添加进程崩溃监控
- [ ] 实现自动重启机制
- [ ] 考虑使用 Worker Threads 替代隐藏窗口
