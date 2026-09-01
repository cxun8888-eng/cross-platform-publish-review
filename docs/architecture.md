# 架构

```text
[Host application]
  protocol package → fragment draft
              ↓
[Browser extension on official hosts]
  validate → fill → explicit confirm → receipt fragment
              ↓
[Host callback / review UI]
  manual official URL → FastAPI 202 Job → Celery Worker
                                      → Provider → Repository + snapshots
```

扩展不依赖复盘 Provider，RedFox 不参与发布。`WorkDetailProvider` 与 `ReviewRepository` 是替换点。示例 `X-Scope-Id` 只展示隔离形态；生产系统必须从已验证身份解析作用域。
