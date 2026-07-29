# 回滚演练基线

## Phase 0 回滚

本阶段只新增文档、只读检查脚本及 package scripts。回滚时删除本阶段新增产物并恢复 `package.json`；`src/**`、持久化数据与业务行为不应变化。

## Phase 1 预备回滚点

### 锚点术语

- 业务行为参考基线：`BASELINE.md` 中的 `0dc8538`，仅用于对照原版行为与静态契约。
- Phase 0 开始/业务源码冻结锚点：`ae8284e2fbd0a07e903108e33924fef58b36c1d7`，用于证明 Phase 0 没有改变 `src/**` 与生成物内容。
- Phase 1 进入回滚点：应在 Phase 0 文档、检查脚本、机器证据和真实宿主验收全部闭环后独立登记；当前尚未建立，不得用前两个锚点冒充。

进入 Phase 1 前必须记录：

1. [x] Phase 0 开始锚点 HEAD：`ae8284e2fbd0a07e903108e33924fef58b36c1d7`。主工作树 `src/**` 与 `index.js` 无内容差异；`index.js` 的 HEAD/worktree blob 均为 `7548fee3f2bf833ef4beec39eec809dc0149fddf`。
2. [x] 当前 Phase 0 `npm run check` 完整输出：`docs/phase0-npm-check.log`，退出码为 0。
3. [ ] `BASELINE.md` 的真实 SillyTavern 人工回归结果；尚未取得真实宿主验证证据。
4. [x] localStorage 与 IDB 的 key/schema 清单已登记；只记录名称，不复制用户内容。
5. [x] Phase 0 三份机器基线报告：`phase0-architecture-baseline.json`、`phase0-lifecycle-baseline.json`、`phase0-memory-baseline.json`。

### 持久化锚点

- IndexedDB：数据库 `PhoneModeDB`，store `kv`；静态 key 白名单与动态前缀以 `src/storage.js:37-40` 为准。
- localStorage：白名单以 `src/storage.js:29-36` 为准；日历 key 常量以 `src/constants.js:6-12` 为准。
- 备份、fallback 与事务边界概览见 `DATA_DOMAIN_REPOSITORY.md`；回滚演练不得写入或复制真实用户值。

### Phase 0 机器回滚演练记录

- 在独立 detached worktree 中检出上述 HEAD，执行 `npm ci` 与该锚点原始 `npm run check`，退出码均为 0。
- 构建后的 `index.js` 内容 blob 与锚点一致；Git 仅报告工作树行尾规范化差异，不存在内容漂移。
- 自包含证据保存于 `docs/phase0-rollback-check.log`，包含环境、HEAD、blob、命令退出码、最终状态与清理结果；演练 worktree 已删除，主工作树 `src/**` 与 `index.js` 保持无内容差异。
- 该演练证明 Phase 0 文档、只读脚本及 package scripts 可从业务基线隔离回退；它不能替代真实 SillyTavern 中的功能与持久化回归。
- Phase 1 进入回滚点仍须在真实宿主验收完成后独立记录；当前机器演练不等于该回滚点已建立。

## 演练步骤

- 应用单个原子步骤；构建并执行相关检查。
- 在宿主执行目标功能与失败路径。
- 回退该步骤源码并重新构建生成物。
- 验证旧入口、旧数据、备份恢复和公开全局仍可用。
- 数据写入步骤必须验证持久化恢复，不得只恢复内存对象。

当前状态：机器侧锚点与隔离回滚演练已完成；真实 SillyTavern 人工回归及宿主侧旧入口、旧数据、备份恢复和公开全局验证仍未完成，因此 Phase 0 Exit Gate 继续保持 `in_progress`。
