import { EMPTY_CONVERSATION, parseConversation, type Conversation } from '@qareeb/shared';

const KEY = 'qareeb.assistant.v1';

/**
 * The chat survives back/forward within the tab; a new tab starts fresh. Cards are resolved against
 * live data, so stale ones simply disappear; a stored chat that is unreadable or of an older shape
 * starts over (parseConversation).
 */
export function loadConversation(): Conversation {
  try {
    return parseConversation(sessionStorage.getItem(KEY));
  } catch {
    return EMPTY_CONVERSATION;
  }
}

export function saveConversation(c: Conversation): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(c));
  } catch {
    /* private mode or full storage: the chat just won't survive navigation */
  }
}

