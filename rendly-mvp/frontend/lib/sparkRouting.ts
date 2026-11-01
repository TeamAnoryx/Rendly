/**
 * Where a Spark match sends the user. Text matches open the conversation. Video matches also
 * ask the chat page to start the call, and say whether this side is the initiator.
 */
export function sparkChatUrl(match: { conversation_id: string; mode: 'text' | 'video'; initiator: boolean }): string {
  const params = new URLSearchParams({ conv: match.conversation_id });
  if (match.mode === 'video') {
    params.set('call', 'video');
    params.set('initiator', match.initiator ? '1' : '0');
  }
  return `/dashboard/chat?${params.toString()}`;
}
