# 收工前检查清单

- [ ] 修改范围未越过已批准原子步骤。
- [ ] 未手改 `index.js`；生成物只由既有 build 产生。
- [ ] 运行 `npm run check`，记录失败命令、根因和未执行项。
- [ ] 完成与改动对应的真实 SillyTavern 人工回归；未验证项明确标记。
- [ ] 检查公开 `window.__pm*`、存储 key/schema、DOM/CSS 契约与错误回滚。
- [ ] 检查 listener、timer、controller、overlay、缓存和大对象释放路径。
- [ ] 更新模块文档、计划 TODO 与 `.limcode/progress.md`。
- [ ] 记录完成事实、证据、风险、阻塞、下一步和回滚点。
- [ ] 重新读取设计、计划、进度，确认没有把目标写成已实现。
- [ ] 独立验收通过后再结束本轮。
