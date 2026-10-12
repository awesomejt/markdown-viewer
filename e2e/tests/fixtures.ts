import { expect, test as base } from '@playwright/test';

/**
 * Offline guard (NFR-5: no internet/CDN). Every spec imports `test`/`expect` from here. An auto fixture
 * routes all requests of the test's context: anything not to 127.0.0.1/localhost is aborted and recorded,
 * and the test fails at teardown if any were recorded. `data:`/`blob:` URLs are excluded from the route (WebKit breaks blob: images otherwise).
 *
 * Markdown may intentionally contain remote images (accepted, D-26). Those are still aborted (so nothing
 * leaves the machine), but a test that loads such a fixture lists them in `allowedRemote` so they are not
 * counted as violations. No current fixture needs this.
 */
type Options = { allowedRemote: RegExp[] };
type Fixtures = { remoteRequests: string[] };

const isLocal = (url: string): boolean => {
  const { hostname } = new URL(url);
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]';
};

export const test = base.extend<Fixtures & Options>({
  allowedRemote: [[], { option: true }],
  remoteRequests: [
    async ({ context, allowedRemote }, use) => {
      const seen: string[] = [];
      // Match http(s) only: WebKit breaks blob: images if they pass through a route handler.
      await context.route(/^https?:/, (route) => {
        const url = route.request().url();
        if (isLocal(url)) return route.fallback();
        if (!allowedRemote.some((re) => re.test(url))) seen.push(url);
        return route.abort('blockedbyclient');
      });
      await use(seen);
      expect(seen, 'non-local requests attempted').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
