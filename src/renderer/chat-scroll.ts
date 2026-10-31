export interface ConversationScroll {
  scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
}

/** Capture before adding/replacing text, while the old bottom is still valid. */
export function isConversationAtBottom(conversation: ConversationScroll): boolean {
  return conversation.scrollHeight - conversation.clientHeight - conversation.scrollTop <= 32;
}

export function scrollConversationToBottom(conversation: ConversationScroll): void {
  conversation.scrollTop = conversation.scrollHeight;
}
