# 宿主项目接入指南

本指南面向要把发布桥接和作品复盘引入另一个产品的开发者。

## 1. 选择接入范围

可以独立选择：

| 范围 | 所需组件 |
| --- | --- |
| 只做辅助发布 | Protocol + 浏览器扩展 + 宿主回调页 |
| 只做作品复盘 | FastAPI 路由或领域/Provider/Repository 代码 |
| 完整闭环 | 上述全部组件 |

RedFox 不是发布桥接的依赖，浏览器扩展也不应该知道 RedFox 的存在。

## 2. 引入协议包

`@publish-review/protocol` 当前是仓库 Workspace，尚未发布到 npm。可选方式：

1. 把 `packages/protocol/` 复制到你的 monorepo；
2. 将整个仓库作为 Git submodule，再用本地 `file:` 依赖；
3. 提取 `src/index.ts` 到你的共享包并保留测试；
4. 由你自己的组织发布内部 npm 包。

本地 `file:` 示例：

```json
{
  "dependencies": {
    "@publish-review/protocol": "file:../cross-platform-publish-review/packages/protocol"
  }
}
```

安装后使用：

```ts
import { buildDraftHandoffUrl } from "@publish-review/protocol";

const handoffUrl = buildDraftHandoffUrl({
  source: "publish-review-demo",
  platform: "xiaohongshu",
  returnTarget: "wizard",
  title: "城市漫游：把周末交给一条老街",
  content: "这是准备公开发布的正文。",
  tags: ["城市旅行", "周末路线"],
});

window.location.assign(handoffUrl);
```

重要限制：当前公开扩展只接受 `source: "publish-review-demo"`。如果要改成产品自己的 Source，必须同步修改抖音/小红书与微博内容脚本的校验，并更新安全契约测试。

在 Next.js 等支持 SSR 的框架中，构造 URL 的代码应在浏览器侧运行，因为实现使用 `btoa`、`atob`、`TextEncoder` 和 `TextDecoder`。

## 3. 设计发起入口

建议每条待发布内容单独提供平台按钮：

```ts
function publishTo(platform: "douyin" | "xiaohongshu" | "weibo") {
  const url = buildDraftHandoffUrl({
    source: "publish-review-demo",
    platform,
    returnTarget: "workspace",
    title: currentDraft.title,
    content: currentDraft.content,
    tags: currentDraft.tags,
  });
  window.location.assign(url);
}
```

当前标签跳转能让用户明确看到跨站过程，并允许扩展在同一标签返回。不要把账号凭据、内部 ID、租户信息、预算或未公开数据放进 payload。

## 4. 实现回调页

```ts
import { parsePublicationReceipt } from "@publish-review/protocol";

export function consumePublicationReceipt(): void {
  try {
    const receipt = parsePublicationReceipt(window.location.hash);
    if (!receipt) return;

    // 只把回执当成 UI 接力，不把它当作可信发布证明。
    sessionStorage.setItem("latest-publication-receipt", JSON.stringify(receipt));
  } catch (error) {
    console.warn("Invalid publication receipt", error);
  } finally {
    history.replaceState(null, document.title, `${location.pathname}${location.search}`);
  }
}
```

回执没有签名，任何页面访问者都能构造。生产业务不能仅凭 `resolved` 发放权益、扣减库存或确认订单。

`returnMode` 可用于 UI 分流：

- `workspace`：进入普通发布清单；
- `wizard`：先显示向导内“正在前往作品复盘”，再由前端导航到复盘区域。

回调地址本身不随 `returnMode` 改变。

## 5. 配置扩展信任目标

每位用户需要在扩展弹窗保存：

- 宿主应用 HTTPS Origin；
- 固定回调路径。

生产例子：

```text
应用地址：https://console.example.com
回调路径：/marketing/publication/callback
```

草稿不能动态控制回调地址，这可以避免恶意 payload 把回执带到攻击者站点。

如果要免人工配置，建议维护你自己的扩展分支，在构建期固化受控 Origin；不要重新允许 payload 传任意 callback URL。

## 6. 接入作品复盘后端

推荐保留三层边界：

```text
API / application service
    ↓ WorkReference
WorkDetailProvider
    ↓ WorkDetail
ReviewRepository
```

### 认证与作用域

示例使用客户端 `X-Scope-Id`，仅用于演示。生产应改为：

```python
scope_id = current_user.tenant_id
```

所有创建、查询任务和复盘列表都必须验证作用域。当前 `GET job` 示例没有作用域校验，不能原样暴露公网。

### 数据库

替换 SQLite 时保留：

- `(scope_id, platform, work_id)` 唯一约束；
- `(review_id, captured_at)` 快照唯一约束；
- `(scope_id, idempotency_key)` Job 唯一约束；
- 同键不同请求冲突；
- 旧快照不覆盖最新详情。

生产建议 PostgreSQL + Alembic，并把 API 与 Worker 指向同一数据库。

### 任务队列

保留 `202 + Job` 边界，不要在请求线程中同步等待供应商：

- 配置 `acks_late` 与 worker-lost 策略；
- 只对超时、连接错误、429、可恢复 5xx 有界重试；
- 供应商已成功但数据库失败时，避免再次收费查询；
- 对任务终态、失败率和队列积压告警。

公开版是可读参考，尚未完整实现以上生产级投递语义。

## 7. 接入自己的 Provider

```python
class MyProvider:
    async def fetch(self, reference: WorkReference) -> WorkDetail:
        response = await my_client.get_by_id(reference.work_id)
        return WorkDetail(
            platform=reference.platform,
            work_id=reference.work_id,
            work_url=reference.work_url,
            title=response.title,
            content=response.content,
            cover_url=response.cover,
            published_at=response.published_at,
            captured_at=now_iso(),
            metrics={"likes": response.likes},
        )
```

Provider 必须：

- 只接收已规范化 `WorkReference`；
- 自己处理固定 Endpoint、超时和错误分类；
- 不把 Key 或完整原始响应写日志/数据库；
- 把缺失值保留为 `null`，不要把真实 `0` 当缺失；
- 用 Mock Transport 测试，不在普通 CI 调真实服务。

## 8. 增加发布平台

需要同步：

1. `PublishPlatform` 和目标 URL；
2. Manifest 的精确 host permission；
3. 新内容脚本或 `PublisherAdapter`；
4. Service Worker 的消息来源校验；
5. 作品 URL 规范化与回执能力；
6. 平台状态机和安全不变量测试；
7. 能力矩阵、隐私文档和兼容性记录。

禁止为了省事加入 `<all_urls>`。

## 9. 生产化检查清单

- [ ] 使用测试账号完成三个平台的人工回归；
- [ ] 宿主和回调全站 HTTPS；
- [ ] Source、Origin、回调路径使用受控配置；
- [ ] 回执只用于 UI 接力，重要事实由服务端验证；
- [ ] 服务端身份系统生成 scope；
- [ ] PostgreSQL 事务和迁移已实现；
- [ ] Redis/Celery 有监控、有界重试和死信处理；
- [ ] API 限流、CORS 白名单、审计日志已配置；
- [ ] Provider Secret 只注入 Worker；
- [ ] 日志和错误响应不含 Key/原始供应商数据；
- [ ] 平台 DOM 变化有回归测试和降级开关；
- [ ] 已审查各平台规则、隐私法律与供应商合同；
- [ ] 扩展隐私披露与分发方式满足目标浏览器商店要求。
