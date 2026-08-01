import { createEmojiRenderBudget } from './emoji-media.js';
import { createBubbles } from './messaging.js';
import { escapeHtml } from './ui.js';

export function createPhoneMessages(state, quote) {
    let emojiRenderBudget = createEmojiRenderBudget();
    const resetEmojiRenderBudget = () => { emojiRenderBudget = createEmojiRenderBudget(); };
    function applyBubbleMetadata(node, metadata) {
        if (!metadata) return;
        if (metadata.historyIndex !== undefined) node.dataset.historyIndex = String(metadata.historyIndex);
        if (metadata.messageId) node.dataset.messageId = String(metadata.messageId);
        if (metadata.bubbleId) node.dataset.bubbleId = String(metadata.bubbleId);
        if (metadata.pendingId !== undefined) node.dataset.pendingId = String(metadata.pendingId);
        if (metadata.pendingStatus) node.dataset.pendingStatus = metadata.pendingStatus;
        if (metadata.pendingId !== undefined) node.classList.add('pm-pending-entry');
    }
    function attachQuoteUi(root, bubble, text, senderName, metadata) {
        if (metadata?.quote && !bubble.querySelector('.pm-reply-card')) {
            const card = document.createElement('button');
            card.type = 'button'; card.className = 'pm-reply-card';
            card.dataset.quoteMessageId = metadata.quote.messageId; card.dataset.quoteBubbleId = metadata.quote.bubbleId;
            const sender = document.createElement('span'); sender.className = 'pm-reply-card-sender'; sender.textContent = metadata.quote.sender || '群聊消息';
            const snapshot = document.createElement('span'); snapshot.className = 'pm-reply-card-text'; snapshot.textContent = metadata.quote.text;
            card.append(sender, snapshot);
            card.addEventListener('click', event => {
                event.stopPropagation();
                if (quote.syncReplyCardAvailability(card)) quote.locateQuotedBubble({ messageId: card.dataset.quoteMessageId, bubbleId: card.dataset.quoteBubbleId });
            });
            quote.syncReplyCardAvailability(card);
            bubble.prepend(card);
        }
        if (metadata?.pendingId !== undefined || !metadata?.messageId || !metadata?.bubbleId || root.querySelector('.pm-quote-action')) return;
        const action = document.createElement('button'); action.type = 'button'; action.className = 'pm-quote-action'; action.textContent = '引用';
        action.setAttribute('aria-label', `引用${senderName || (metadata.sender || '我')}的消息`);
        action.addEventListener('click', event => {
            event.stopPropagation();
            quote.setActiveQuote({ messageId: String(metadata.messageId), bubbleId: String(metadata.bubbleId), sender: String(senderName || metadata.sender || '我'), text: String(text || '') });
        });
        root.appendChild(action);
    }
    function addBubble(text, side, senderName, historyIndex, metadata) {
        const list = state.phoneWindow?.querySelector('.pm-msg-list'); if (!list) return [];
        const nodes = createBubbles(text, side, senderName, { groupColorMap: state.groupColorMap, groupMembers: state.groupMembers, emojis: window.__pmEmojis, emojiBudget: emojiRenderBudget });
        nodes.forEach(b => {
            applyBubbleMetadata(b, metadata);
            if (b.classList?.contains('pm-bubble')) {
                b.dataset.side = side; b.dataset.text = text;
                if (historyIndex !== undefined) b.dataset.historyIndex = historyIndex;
                attachQuoteUi(b, b, text, senderName, metadata);
            } else if (b.classList?.contains('pm-group-bubble-wrap')) {
                b.dataset.side = side; b.dataset.text = text;
                if (historyIndex !== undefined) b.dataset.historyIndex = historyIndex;
                const inner = b.querySelector('.pm-bubble'); if (inner) {
                    applyBubbleMetadata(inner, metadata); inner.dataset.side = side; inner.dataset.text = text;
                    if (historyIndex !== undefined) inner.dataset.historyIndex = historyIndex;
                    attachQuoteUi(b, inner, text, senderName, metadata);
                }
            }
            list.appendChild(b);
        });
        list.scrollTop = list.scrollHeight;
        return nodes;
    }
    function rebaseRenderedHistory(trimmedCount) {
        if (!Number.isInteger(trimmedCount) || trimmedCount <= 0) return;
        const list = state.phoneWindow?.querySelector('.pm-msg-list'); if (!list) return;
        for (const child of [...list.children]) {
            const indexed = child.dataset.historyIndex !== undefined ? child : child.querySelector?.('[data-history-index]');
            if (!indexed) continue;
            const previousIndex = Number(indexed.dataset.historyIndex); if (!Number.isInteger(previousIndex)) continue;
            if (previousIndex < trimmedCount) { child.remove(); continue; }
            const nextIndex = String(previousIndex - trimmedCount);
            if (child.dataset.historyIndex !== undefined) child.dataset.historyIndex = nextIndex;
            child.querySelectorAll?.('[data-history-index]').forEach(node => { node.dataset.historyIndex = nextIndex; });
        }
        quote.refreshReplyCardAvailability();
    }
    function addNote(text) {
        const list = state.phoneWindow?.querySelector('.pm-msg-list'); if (!list) return;
        const n = document.createElement('div'); n.className = 'pm-note'; n.textContent = text;
        list.appendChild(n); list.scrollTop = list.scrollHeight;
    }
    function addDirector(text, metadata) {
        const list = state.phoneWindow?.querySelector('.pm-msg-list'); if (!list) return null;
        const d = document.createElement('div'); d.className = 'pm-director'; applyBubbleMetadata(d, metadata);
        d.innerHTML = `<span class="pm-director-icon">🎬</span><span class="pm-director-text">${escapeHtml(text)}</span>`;
        list.appendChild(d); list.scrollTop = list.scrollHeight; return d;
    }
    function showTyping() {
        const list = state.phoneWindow?.querySelector('.pm-msg-list');
        if (!list || document.getElementById('pm-typing')) return;
        const t = document.createElement('div'); t.id = 'pm-typing'; t.className = 'pm-bubble pm-left pm-typing-bubble';
        t.innerHTML = '<span></span><span></span><span></span>'; list.appendChild(t); list.scrollTop = list.scrollHeight;
    }
    function hideTyping() { document.getElementById('pm-typing')?.remove(); }
    return { addBubble, addNote, addDirector, rebaseRenderedHistory, resetEmojiRenderBudget, showTyping, hideTyping };
}
