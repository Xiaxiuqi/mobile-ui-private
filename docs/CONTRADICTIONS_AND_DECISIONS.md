# 冲突与决策登记

## C-001 设计状态与执行状态

- 冲突：设计文档保持目标架构描述；实施计划已批准并进入 Phase 0。
- 决策：执行状态以 `.limcode/plans/mobile-ui-private-modularization.md` 与 `.limcode/progress.md` 为准；设计正文不伪装实现完成。

## C-002 版本标识

- 事实：`manifest.json` 与 `package.json` 为 `1.5.0`；`BASELINE.md` 记录启动日志 `[phone-mode] v9.5.7`。
- 决策：二者属于不同标识来源，Phase 0 只登记，不擅自统一版本字符串。

## C-003 模块化不等于内存优化

- 事实：当前 bundle 是单一 IIFE；拆文件不会自动减少运行时内存。
- 决策：内存改善必须由 scope、淘汰、最小快照和 profiling 证明。

## C-004 检查环境

- 事实：首次 `npm run check` 因依赖未安装而失败；`npm ci` 使用锁文件安装依赖。
- 决策：将环境失败与代码失败分开记录，不通过跳过检查伪装成功。

## C-005 基线与回滚锚点

- 事实：`BASELINE.md` 的 `0dc8538` 是业务行为参考基线；Phase 0 开始时业务源码冻结在 `ae8284e2fbd0a07e903108e33924fef58b36c1d7`。
- 决策：二者都不得冒充 Phase 1 进入回滚点。Phase 1 进入点只能在 Phase 0 机器证据与真实宿主验收全部闭环后独立登记。
