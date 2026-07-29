# 数据域与仓储基线

| 数据域 | 主入口 | 主存储 | fallback / 补偿 |
|---|---|---|---|
| 聊天历史 | `storage.js:46-152` | IDB `ST_SMS_DATA_V2` | localStorage 镜像 |
| 群聊配置 | `storage.js:298-351` | IDB `ST_SMS_GROUP_META` | localStorage 主键与 `_LOCAL_FALLBACK` |
| 表情 | `storage.js:154-180` | IDB `ST_SMS_EMOJIS` | `_LOCAL_FALLBACK` |
| 日历 | `calendar-storage.js` | localStorage 多个 `ST_SMS_CALENDAR_*` | 提交器内回滚 |
| 社区 | `storage.js:467-524` | IDB `ST_INTERACTIVE_SCENES_V1` | `_LOCAL_FALLBACK` |
| 背景 | `storage-background.js` | localStorage 指针 + IDB 大对象 | 事务式恢复 |
| 分支继承 | `storage.js:595-688` | IDB `ST_SMS_BRANCH_LINEAGE_V1` | 串行队列与 revision |
| UI 状态 | `storage.js:526-575` | localStorage `ST_SMS_PHONE_UI_STATE` | scope 合并 |

完整 localStorage 与 IDB 白名单见 `storage.js:29-40`。Phase 6 前必须按真实事务/回滚边界决定 repository，不按文件名机械拆分。
