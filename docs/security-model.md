# 安全模型

1. Fragment 不进入 HTTP 请求；内容脚本读取后立即清除。
2. 草稿不能指定回调 URL；扩展只返回用户预先配置的 HTTPS Origin + 固定路径。
3. Background 校验消息发送标签页的官方 Host。
4. 最终按钮要求唯一、可见、可用，并保留用户确认。
5. `debugger` 可选且短暂 attach；失败时降级为手动操作。
6. 作品链接只做本地解析，Provider 请求发送到 Worker 配置的固定 HTTPS 地址。
7. Worker 成功后直接持久化，不接受前端声称的供应商指标。

生产化时还应加入身份认证、限流、PostgreSQL 约束、脱敏日志、CORS 白名单和任务监控。
