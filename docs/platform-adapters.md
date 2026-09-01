# 平台适配指南

平台 DOM 不是稳定 API。修改适配器必须保留：只匹配官方 Host；素材只打开文件选择器；最终动作前由用户核对；目标按钮必须唯一、可见、可用；“按钮已触发”不等于“平台确认成功”；公开链接需限定成功页或标题匹配范围。

当前抖音与小红书共用 `creator-content.ts`，微博在 `weibo-content.ts`。继续扩展时建议拆为 `PublisherAdapter`：`matchesPage`、`fillDraft`、`openAssetPicker`、`findUniqueFinalAction`、`resolveReceipt`、`scrapeMetrics`。
