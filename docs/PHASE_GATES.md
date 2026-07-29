# 阶段门禁

## Phase 0 Exit Gate

- [x] installer、公开全局、持久化键和静态副作用可重复枚举。
- [x] 功能矩阵关联真实入口与自动/人工证据。
- [x] 只读 architecture/lifecycle/memory 基线脚本已建立。
- [x] `npm run check` 全量通过并记录结果（`docs/phase0-npm-check.log`；architecture/lifecycle/memory 三份 JSON 基线已生成）。
- [ ] 在真实 SillyTavern 完成 `BASELINE.md` 人工回归。
- [ ] 完成宿主侧回滚验证并独立登记 Phase 1 进入回滚点（Phase 0 开始锚点的 detached-worktree 机器演练已通过；仍待旧入口、旧数据、备份恢复和公开全局验证）。

未完成项存在时 Phase 0 保持 `in_progress`，不得进入 Phase 1。

## 后续通用 Gate

每个原子步骤必须满足：构建与相关检查通过；旧公开入口和存储格式不变；人工宿主回归通过；资源计数不恶化；文档、风险与回滚点同步。

## 停止条件

发现未登记 `window.__pm*` 调用方、数据 key/schema 漂移、双向状态镜像无唯一 owner、检查失败或真实宿主无法验证时，立即停止后续阶段。
