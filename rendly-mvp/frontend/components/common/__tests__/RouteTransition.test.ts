import { isInternalNavigation, MAX_VISIBLE_MS, MIN_VISIBLE_MS } from '../RouteTransition';

function anchor(href: string, attrs: Record<string, string> = {}): HTMLAnchorElement {
  const a = document.createElement('a');
  a.href = href;
  Object.entries(attrs).forEach(([k, v]) => a.setAttribute(k, v));
  return a;
}

function click(init: MouseEventInit = {}): MouseEvent {
  return new MouseEvent('click', { button: 0, cancelable: true, ...init });
}

describe('isInternalNavigation', () => {
  test('a plain click on a same-origin link to another page shows the loader', () => {
    expect(isInternalNavigation(click(), anchor('/dashboard/huddles'), '/dashboard')).toBe(true);
  });

  test('the same page, other origins, new tabs, modifier clicks and downloads do not', () => {
    expect(isInternalNavigation(click(), anchor('/dashboard'), '/dashboard')).toBe(false);
    expect(isInternalNavigation(click(), anchor('https://example.com/x'), '/dashboard')).toBe(false);
    expect(isInternalNavigation(click(), anchor('/x', { target: '_blank' }), '/dashboard')).toBe(false);
    expect(isInternalNavigation(click({ ctrlKey: true }), anchor('/x'), '/dashboard')).toBe(false);
    expect(isInternalNavigation(click(), anchor('/file.pdf', { download: '' }), '/dashboard')).toBe(false);
  });

  test('the loader is bounded between 300 ms and 5000 ms', () => {
    expect(MIN_VISIBLE_MS).toBe(300);
    expect(MAX_VISIBLE_MS).toBe(5000);
  });
});
