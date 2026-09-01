# 安全模型

本项目跨越宿主应用、浏览器扩展、官方平台页面、任务队列和外部数据商。安全目标是最小权限、明确用户确认、固定信任目标和服务端 Secret 隔离。

## 资产

| 资产 | 位置 | 保护要求 |
| --- | --- | --- |
| 平台登录态 | 官方平台/浏览器 | 扩展不读取、不复制、不上传 |
| 公开草稿 | 宿主 → fragment → 内容脚本 | 只包含准备公开的信息，读取后清理 |
| 回调配置 | 扩展本地存储 | 仅用户可修改，禁止 payload 覆盖 |
| 发布回执 | fragment | 最小化、及时清理、不作为可信业务证明 |
| Provider Key | Celery Worker 环境 | 不进入 Web、扩展、API、数据库、日志 |
| 作品与指标 | 服务端数据库 | 按已认证 scope 隔离并设置保留期 |

## 信任区域

```text
低信任输入：草稿内容、平台 DOM、用户粘贴 URL、Provider 响应
    │
    ├─ Browser boundary：官方 Host + 类型/长度/数值校验
    │
    └─ Server boundary：官方 URL 解析 + Provider 归一化 + Repository 约束

高敏感区域：平台登录态、Worker Secret、生产数据库
```

平台 DOM 和 Provider 返回值都属于外部不可信数据，不能因为来源是官方页面或付费服务就跳过校验。

## 主要威胁与缓解

| 威胁 | 缓解 |
| --- | --- |
| 草稿进入平台 HTTP 日志 | 使用 fragment，不使用 query/body；读取后立即清理 |
| 恶意草稿指定回调站点 | payload 不含 callback；只使用扩展中保存的 Origin + 路径 |
| 非官方页面伪造扩展消息 | manifest 精确 Host + Service Worker 再校验 sender tab URL |
| 扩展误点错误按钮 | 用户确认、唯一性、可见性、可用性、正文一致性检查 |
| 读取用户本地文件 | 只打开系统文件选择器，不读取或自动选择文件 |
| 高权限长期占用 | `debugger` 设为 optional，按用户手势申请并在 `finally` detach |
| 作品链接 SSRF | 后端只解析官方 HTTPS URL/ID，不请求用户粘贴的 URL |
| 回盘关联到别人的作品 | 按本次标题锁定行；不回退看板第一行或账号总览 |
| Provider Key 泄露 | 只注入 Worker；不落库、不响应、不记录 Header |
| 任意 Provider 重定向 | 固定 HTTPS Endpoint，`follow_redirects=False` |
| 跨租户访问 | 生产从认证身份解析 scope；示例 Header 不可直接沿用 |
| 客户端伪造供应商指标 | Worker 查询成功后直接持久化，不接受前端提交 Provider 结果 |
| 重复收费查询 | 幂等键 + 请求摘要；生产还需保存已获取的 Provider 结果 |

## Fragment 的真实边界

Fragment 不会发送给目标站点服务器，但不是秘密：

- 当前页面脚本能读取；
- 其他高权限扩展可能读取；
- 浏览器同步或故障报告可能保留导航信息；
- payload 是编码，不是加密。

因此只能携带游客将要看到的公开标题、正文和标签。禁止放入 Token、手机号、租户 ID、预算、库存、内部审批意见或 Provider Key。

内容脚本读取后调用 `history.replaceState`，并在当前标签 `sessionStorage` 中最多保留 10 分钟。

## 回执不是可信证明

`publication_receipt` 没有签名、Nonce 或服务端关联 ID，任何能构造 URL 的人都可以伪造。它适合：

- 展示“已从平台返回”；
- 把作品公开 URL 带到复盘表单；
- 在向导和工作区之间做 UI 分流。

它不适合：

- 扣减库存；
- 确认订单或收入；
- 发放权益；
- 认定平台审核通过；
- 作为审计证据。

关键事实应通过官方 API、人工核验或服务端 Provider 验证。

## 扩展权限

基础权限只有 `storage` 和四个精确官方 Host。可选 `debugger` 权限能力较强，应在隐私披露中解释，并保持：

1. 只在用户直接操作后申请；
2. 只允许当前受支持的官方标签；
3. 坐标有边界，closed Shadow DOM 按钮有精确文本/样式约束；
4. 每次操作后立即 detach；
5. 拒绝或失败时可手动完成。

不得新增 `<all_urls>`、Cookie 或网络拦截权限来绕过适配问题。

## RedFox Secret 隔离

正确部署：

```text
Web/Extension: no key
FastAPI:       no key
Celery Worker: REDFOX_API_KEY + fixed endpoints
Database:      normalized detail only
```

代码使用共享 `Settings` 类型，并不能自动阻止运维把 Key 注入 API 容器。因此“只在 Worker”最终依赖部署层的 Secret 作用域。应为 API 和 Worker 使用不同的运行身份和 Secret 配置。

## 数据保留

- 草稿会话：最多 10 分钟；
- 扩展配置：直到用户修改、清除或卸载；
- Celery result：默认 24 小时；
- SQLite 作品、任务预约、快照：默认不自动删除。

生产系统必须增加明确的数据保留、删除、导出和租户清理流程。

## 生产部署要求

- HTTPS 与 HSTS；
- 服务端身份认证、授权和 scope 隔离；
- PostgreSQL 事务、迁移、备份和加密；
- API 限流、请求大小限制、CORS 白名单；
- Worker 有界重试、超时、死信和告警；
- Secret Manager 注入 Worker，定期轮换；
- 结构化日志，禁止 Header、Key、完整 Provider 响应；
- 依赖扫描、Secret 扫描和浏览器扩展发布审查；
- 真实平台测试账号与人工回归；
- 遵守平台规则、隐私法律和供应商合同。

更多实现细节见[技术原理详解](technical-deep-dive.md)，漏洞报告方式见[安全策略](../SECURITY.md)。
