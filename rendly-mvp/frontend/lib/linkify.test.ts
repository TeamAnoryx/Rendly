import { huddleIdFromUrl, linkify } from './linkify';

describe('linkify', () => {
  it('returns plain text unchanged', () => {
    expect(linkify('hello there')).toEqual([{ kind: 'text', text: 'hello there' }]);
  });

  it('turns http(s) and www links into links, leaving trailing punctuation as text', () => {
    expect(linkify('see https://example.com/a?b=1, ok')).toEqual([
      { kind: 'text', text: 'see ' },
      { kind: 'link', text: 'https://example.com/a?b=1', href: 'https://example.com/a?b=1' },
      { kind: 'text', text: ', ok' },
    ]);
    expect(linkify('(www.example.org)')).toEqual([
      { kind: 'text', text: '(' },
      { kind: 'link', text: 'www.example.org', href: 'https://www.example.org' },
      { kind: 'text', text: ')' },
    ]);
  });

  it('never links other schemes', () => {
    expect(linkify('javascript:alert(1) data:text/html,x')).toEqual([{ kind: 'text', text: 'javascript:alert(1) data:text/html,x' }]);
  });

  it('flags huddle invite links, with or without the base path', () => {
    const tokens = linkify('join https://anoryxtechsolutions.com/rendly.app/dashboard/huddles/abc-123 now');
    expect(tokens[1]).toEqual({
      kind: 'huddle',
      text: 'https://anoryxtechsolutions.com/rendly.app/dashboard/huddles/abc-123',
      href: 'https://anoryxtechsolutions.com/rendly.app/dashboard/huddles/abc-123',
      huddleId: 'abc-123',
    });
    expect(huddleIdFromUrl('http://localhost:3001/dashboard/huddles/xyz9?ref=chat')).toBe('xyz9');
    expect(huddleIdFromUrl('https://example.com/dashboard/huddles')).toBeNull();
  });

  it('handles several links in one message', () => {
    const kinds = linkify('a https://x.io b https://y.io/dashboard/huddles/h1234').map((t) => t.kind);
    expect(kinds).toEqual(['text', 'link', 'text', 'huddle']);
  });
});
