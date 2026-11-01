import { sparkChatUrl } from '@/lib/sparkRouting';

const CONV = 'whisper_11111111-1111-4111-8111-111111111111_22222222-2222-4222-8222-222222222222';

describe('sparkChatUrl', () => {
  test('text match opens the conversation without starting a call', () => {
    const url = sparkChatUrl({ conversation_id: CONV, mode: 'text', initiator: true });
    expect(url).toBe(`/dashboard/chat?conv=${encodeURIComponent(CONV)}`);
    expect(url).not.toContain('call=');
  });

  test('video match asks the chat page to call, and tells the initiator apart', () => {
    const initiator = new URLSearchParams(sparkChatUrl({ conversation_id: CONV, mode: 'video', initiator: true }).split('?')[1]);
    expect(initiator.get('call')).toBe('video');
    expect(initiator.get('initiator')).toBe('1');
    expect(initiator.get('conv')).toBe(CONV);

    const partner = new URLSearchParams(sparkChatUrl({ conversation_id: CONV, mode: 'video', initiator: false }).split('?')[1]);
    expect(partner.get('initiator')).toBe('0');
  });
});
