# 功能覆盖矩阵

| 功能 | 真实入口 | 自动证据 | 人工证据 | 状态 |
|---|---|---|---|---|
| 启动与 `/phone` | `main.js`、`phone-lifecycle.js` | `check:contracts` | `BASELINE.md` 清单 | 待宿主验证 |
| 单聊/群聊 | `conversation.js`、`phone-chat.js`、`phone-directory.js` | `check:behavior`、`check:pending` | 单聊、群聊回归 | 待宿主验证 |
| AI/取消 | `ai.js`、`phone-foundation.js` | `check:ai` | 取消与旧结果拒绝 | 待宿主验证 |
| 表情 | `emoji-ui.js`、`emoji-media.js` | `check:emoji` | 导入与发送 | 待宿主验证 |
| 日历 | `calendar.js` 及 `calendar-*` | `check:calendar` | 生成、保存、回滚 | 待宿主验证 |
| 社区 | `interactive-scenes.js` 及 `interactive-scene-*` | `check:interactive` | 创建、评论、删除、注入 | 待宿主验证 |
| 设置/备份 | `settings-ui.js`、`settings-backup.js` | `check:contracts` | 导入、导出、清空 | 待宿主验证 |
| 世界书权限 | `settings-worldbook.js`、`worldbook-context.js` | `check:permissions` | 懒加载与栏目选择 | 待宿主验证 |

任何“待宿主验证”不得标记生产通过。
