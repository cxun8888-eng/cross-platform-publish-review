# 架构摘要

本文用于快速定位组件；完整协议、状态机、时序和安全分析见[技术原理详解](technical-deep-dive.md)。

## 两条独立链路

```text
发布桥接
Host → Draft Fragment → Extension → Official Platform → Receipt Fragment → Host

作品复盘
Host → FastAPI 202 Job → Redis/Celery → Provider → Repository/Snapshots
```

RedFox 只实现第二条链路的 Provider，不参与浏览器发布。

## 组件图

```text
┌──────────────────── Browser ────────────────────┐
│                                                │
│  Host application / Web Demo                   │
│    └─ @publish-review/protocol                 │
│               │ fragment                       │
│               ▼                                │
│  Official platform page                        │
│    └─ Content Script + closed Shadow DOM UI    │
│               │ chrome.runtime message         │
│               ▼                                │
│  Extension Service Worker                      │
│    └─ host validation / short-lived CDP / return│
└───────────────────────┬────────────────────────┘
                        │ REST
┌──────────────────── Server ─────────────────────┐
│ FastAPI → Redis broker → Celery Worker          │
│                              ├─ Mock Provider   │
│                              └─ RedFox Provider │
│                                   │             │
│                             Review Repository   │
│                  job / work / immutable snapshot│
└─────────────────────────────────────────────────┘
```

## 模块职责

| 目录 | 职责 | 可替换性 |
| --- | --- | --- |
| `packages/protocol` | 草稿 URL 与回执解析 | 可复制到宿主共享包 |
| `browser-extension` | 官方页面交接和用户确认 | 按平台持续维护 |
| `web-demo` | 最小宿主参考 UI | 可完全替换 |
| `backend/app/domain.py` | 作品引用、指标与统一详情 | 尽量保持纯领域 |
| `backend/app/providers` | 数据商适配 | 通过 Protocol 替换 |
| `backend/app/repository.py` | 幂等和快照 | 生产替换为 PostgreSQL |
| `backend/app/routes` | HTTP 参考契约 | 接入宿主鉴权后复用 |

## 核心决策

### 不使用 iframe

平台的 CSP、登录态和风控留在官方页面。浏览器扩展只做同标签交接，不仿制平台发布 UI。

### 草稿使用 fragment

避免草稿成为平台 HTTP 请求参数，但 fragment 不是加密，只允许准备公开的文案，读取后立即清理。

### 最终动作需要用户确认

扩展只在官方 Host、唯一可见目标和明确用户手势下继续。验证码、素材选择和平台二次确认仍由用户完成。

### 外部查询进入 Worker

数据商可能慢、限流或收费，FastAPI 返回 `202`，Celery Worker 查询并直接落快照。Key 只注入 Worker。

### 最新详情与历史快照分离

作品表便于读取最新状态，快照表只追加，支持趋势比较和乱序保护。

## 非目标

- 托管平台账号或读取 Cookie；
- 自动读取/上传本地文件；
- 绕过验证码或风控；
- 把回执当作可信支付/订单事实；
- 承诺平台 DOM 永久兼容；
- 提供开箱即用的生产鉴权、监控或 PostgreSQL 部署。

接入和生产化边界见[宿主项目接入指南](integration-guide.md)。
