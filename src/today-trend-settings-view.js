import { TODAY_TREND_LIMITS } from './today-trend-model.js';
import { BACK_ICON_SVG, EDIT_ICON_SVG, REFRESH_ICON_SVG } from './icons.js';
import { escapeAttr, escapeHtml } from './ui.js';
import { trendActionMenu, trendModuleHead } from './today-trend-ui.js';

function batchSettingsGroup(assistantCount, generationBusy, batchDraft = {}) {
    const count = Number.isSafeInteger(assistantCount) && assistantCount >= 0 ? assistantCount : 0;
    const disabled = generationBusy || count < 1;
    const defaultMerge = Math.min(5, Math.max(count, 1));
    const batchEnabled = batchDraft.enabled === true;
    const recentAssistantCount = Number.isSafeInteger(batchDraft.recentAssistantCount) ? batchDraft.recentAssistantCount : 1;
    const mergeAssistantCount = Number.isSafeInteger(batchDraft.mergeAssistantCount) ? batchDraft.mergeAssistantCount : defaultMerge;
    const details = `
        <p class="pm-today-trend-retention-help">当前聊天 AI 回复累计层数：${count}。批量参数会保存到当前聊天设置；启用后才可手动批量更新。</p>
        <label class="pm-today-trend-field"><span>手动处理最近 assistant 层数</span><input class="pm-today-trend-input" name="recentAssistantCount" type="number" inputmode="numeric" min="1" max="${Math.max(count, 1)}" step="1" required value="${recentAssistantCount}" ${disabled ? 'disabled' : ''}></label>
        <label class="pm-today-trend-field"><span>每多少层合并为一次</span><input class="pm-today-trend-input" name="mergeAssistantCount" type="number" inputmode="numeric" min="1" max="${Math.max(count, 1)}" step="1" required value="${mergeAssistantCount}" ${disabled ? 'disabled' : ''}></label>
        <p class="pm-today-trend-retention-help">generationSnapshots：固定保留最近 ${TODAY_TREND_LIMITS.generationSnapshots} 个记录。该容量不可配置，也不会因打开或保存设置触发生成或清理。</p>
        <div class="pm-today-trend-form-actions"><button type="button" data-action="today-trend-batch-generate" ${disabled || !batchEnabled ? 'disabled' : ''}>${generationBusy ? '正在批量更新' : '手动批量更新'}</button></div>`;
    return `<fieldset class="pm-today-trend-batch-settings"><legend>溯及既往楼层更新</legend>
        <label class="pm-today-trend-switch pm-today-trend-batch-switch"><span><b>启用溯及既往楼层更新</b><small>开启后允许按下方参数执行手动批量更新。</small></span><input name="batchEnabled" type="checkbox" role="switch" aria-checked="${batchEnabled === true}"${batchEnabled ? ' checked' : ''}${generationBusy ? ' disabled' : ''}><i aria-hidden="true"></i></label>${details}
    </fieldset>`;
}

function retentionSettingsGroup(scope, revisions, saving, generationBusy, draft) {
    const settings = scope.historyRetentionSettings || {
        archivedDetailLatestEventCount: 2, archivedDetailRetentionFloors: 20, revision: 1,
    };
    const nValue = draft?.archivedDetailLatestEventCount ?? String(settings.archivedDetailLatestEventCount);
    const lValue = draft?.archivedDetailRetentionFloors ?? String(settings.archivedDetailRetentionFloors);
    const available = Number.isSafeInteger(revisions?.scopeRevision) && revisions.scopeRevision >= 0
        && Number.isSafeInteger(revisions?.settingsRevision) && revisions.settingsRevision >= 1;
    const disabled = saving || generationBusy || !available;
    return `<fieldset class="pm-today-trend-retention-settings"><legend>事件追踪归档数据保留设置</legend>
        <p class="pm-today-trend-retention-help">控制已归档事件的可展开阶段详情与日期摘要。默认保留最近 2 个归档事件，或最近 20 楼内归档的事件；N 与 L 任一条件满足即保留。</p>
        <div class="pm-today-trend-retention-fields"><label class="pm-today-trend-field"><span>最近归档事件数 N（0..80）</span><input class="pm-today-trend-input" name="archivedDetailLatestEventCount" type="number" inputmode="numeric" min="0" max="80" step="1" required value="${escapeAttr(nValue)}" ${disabled ? 'disabled' : ''}><small>设为 0 可关闭按事件数量保留。</small></label>
        <label class="pm-today-trend-field"><span>归档后保留楼层数 L（0..1000）</span><input class="pm-today-trend-input" name="archivedDetailRetentionFloors" type="number" inputmode="numeric" min="0" max="1000" step="1" required value="${escapeAttr(lValue)}" ${disabled ? 'disabled' : ''}><small>设为 0 可关闭按楼层范围保留。</small></label></div>
        <input type="hidden" name="expectedScopeRevision" value="${available ? escapeAttr(String(revisions.scopeRevision)) : ''}"><input type="hidden" name="expectedSettingsRevision" value="${available ? escapeAttr(String(revisions.settingsRevision)) : ''}">
        <p class="pm-today-trend-retention-combinations">组合语义：N&gt;0/L&gt;0 时按 OR 保护；N&gt;0/L=0 时只按最近事件数；N=0/L&gt;0 时只按楼层；N=0/L=0 时不保留可移除详细数据。</p>
        <p class="pm-today-trend-retention-example">示例：L=20 时，在 #32 查看于 #12 归档的事件仍受保护；到 #33 时，仅当 N 条件仍满足才继续保留。</p>
        <p class="pm-today-trend-retention-warning">保存只更新保留策略，不会立即清理。缩小配置后，后续成功事务可能在安全点不可逆删除超出保护范围的详细数据；聊天回退不会恢复，之后增大配置也不会复活已删除正文。事件固定核心始终保留，包括标题、起因、主体与结果。</p>
        <div class="pm-today-trend-form-actions pm-today-trend-retention-save"><button type="submit" ${disabled ? 'disabled' : ''} aria-busy="${saving}">${saving ? '正在保存保留设置' : '保存归档保留设置'}</button></div>
        ${available ? '' : '<p class="pm-today-trend-retention-unavailable" role="status">canonical 修订信息不可用，当前禁止保存。</p>'}
    </fieldset>`;
}

export function renderTodayTrendSettingsView({ scope = null, presets = [], generationBusy = false, menuOpenId = null,
    retentionRevisions = null, retentionSaving = false, retentionDraft = null, errorHtml = '', assistantCount = 0, batchDraft = {} } = {}) {
    if (!scope) return '<section class="pm-today-trend-settings"><h3>APP 总设置</h3><p class="pm-today-trend-empty">请先创建或绑定世界预设。</p></section>';
    const options = presets.map(preset => `<option value="${escapeAttr(preset.id)}" ${preset.id === scope.presetId ? 'selected' : ''}>${escapeHtml(preset.name)}</option>`).join('');
    const rules = [['world', '世界态势规则'], ['reputation', '个人风评规则'], ['faction', '势力图谱规则'], ['dynamics', '动态总规则'], ['incident', '突发事件规则'], ['rumor', '流言蜚语规则'], ['underground', '地下线规则']].map(([name, label]) => `<div class="pm-today-trend-rule-row"><span>${label}</span>${trendActionMenu({ id: `app-rule:${name}`, open: menuOpenId === `app-rule:${name}`, label: `${label}操作`, actions: [{ action: `today-trend-edit-${name}-rule`, icon: EDIT_ICON_SVG, label: `编辑${label}`, attrs: 'data-rule-return="settings"' }, { action: `today-trend-regenerate-${name}-rule`, icon: REFRESH_ICON_SVG, label: `重新生成${label}` }] })}</div>`).join('');
    return `<section class="pm-today-trend-settings">${trendModuleHead({ title: 'APP 总设置', menuId: 'app-settings', menuOpenId, actions: [{ action: 'today-trend-close-settings', icon: BACK_ICON_SVG, label: '返回今日风向' }] })}${errorHtml}<form class="pm-today-trend-editor" data-today-trend-form="app-settings"><label class="pm-today-trend-field">当前世界预设<select class="pm-today-trend-input" name="presetId">${options}</select></label><p class="pm-today-trend-preset-warning">切换世界预设会重建当前作用域。切换完成后请重新打开本页，再单独确认归档保留设置。</p><div class="pm-today-trend-form-actions pm-today-trend-preset-actions"><button type="button" data-action="today-trend-new-preset">新建</button><button type="button" data-action="today-trend-delete-preset">删除</button><button type="button" data-action="today-trend-reinitialize">重建</button><button type="button" data-action="today-trend-rename-preset">重命名</button></div><label class="pm-today-trend-field">调用方式<select class="pm-today-trend-input" name="mode"><option value="manual" ${scope.operation?.mode === 'manual' ? 'selected' : ''}>手动</option><option value="auto" ${scope.operation?.mode === 'auto' ? 'selected' : ''}>自动</option></select></label><label class="pm-today-trend-field">自动调用：每 N 楼执行一次<input class="pm-today-trend-input" name="intervalFloors" type="number" min="1" max="1000" required value="${escapeAttr(String(scope.operation?.intervalFloors || 1))}"></label><label class="pm-today-trend-switch pm-today-trend-injection-switch"><span><b>正文注入</b><small>开启后，角色回复时会参考当前会话中的今日风向。</small></span><input name="injectionEnabled" type="checkbox" role="switch" aria-checked="${scope.injection?.enabled === true}"${scope.injection?.enabled ? ' checked' : ''}><i aria-hidden="true"></i></label><label class="pm-today-trend-switch pm-today-trend-minimal-ui-switch"><span><b>极简 UI</b><small>开启后，通过关系图标切换状态并隐藏关系量表。</small></span><input name="minimalUi" type="checkbox" role="switch" aria-checked="${scope.injection?.minimalUi === true}"${scope.injection?.minimalUi ? ' checked' : ''}><i aria-hidden="true"></i></label><div class="pm-today-trend-form-actions pm-today-trend-settings-save"><button type="submit">保存设置</button></div></form><form class="pm-today-trend-editor" data-today-trend-form="batch-settings">${batchSettingsGroup(assistantCount, generationBusy, batchDraft)}</form><form class="pm-today-trend-editor" data-today-trend-form="retention-settings">${retentionSettingsGroup(scope, retentionRevisions, retentionSaving, generationBusy, retentionDraft)}</form><section class="pm-today-trend-rule"><h3>提示词总览</h3>${rules}</section></section>`;
}
