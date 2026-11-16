describe('withBasePath', () => {
  const load = (base: string) => {
    jest.resetModules();
    process.env.NEXT_PUBLIC_BASE_PATH = base;
    return require('../basePath') as typeof import('../basePath');
  };
  afterAll(() => {
    delete process.env.NEXT_PUBLIC_BASE_PATH;
  });

  test('prefixes app paths when served under a sub-path', () => {
    const { withBasePath } = load('/rendly.app');
    expect(withBasePath('/images/a.png')).toBe('/rendly.app/images/a.png');
    expect(withBasePath('/')).toBe('/rendly.app/');
  });

  test('leaves already-prefixed, external and protocol-relative values alone', () => {
    const { withBasePath } = load('/rendly.app');
    expect(withBasePath('/rendly.app/login')).toBe('/rendly.app/login');
    expect(withBasePath('https://x.com/a')).toBe('https://x.com/a');
    expect(withBasePath('//cdn.x.com/a')).toBe('//cdn.x.com/a');
  });

  test('is a no-op at the root', () => {
    const { withBasePath } = load('');
    expect(withBasePath('/images/a.png')).toBe('/images/a.png');
  });
});
