import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { LISTING_COUNT, perfDir } from './fixtures';

// All timings are in-page performance.now() values, sampled every animation frame (polling: 'raf'),
// so they do not include Playwright's expect() poll back-off or IPC.
const OUT = path.join(perfDir, 'results.jsonl');
const RUNS = 3;
const COUNT = LISTING_COUNT;
const name = (i: number) => `f${String(i).padStart(5, '0')}.md`;

async function throttle(page: Page, rate: number) {
  if (rate === 1) return;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate });
}
function record(info: TestInfo, mode: string, metric: string, ms: number) {
  appendFileSync(OUT, JSON.stringify({ project: info.project.name, mode, metric, ms }) + '\n');
}
/** Resolves with the in-page time (performance.now()) of the first frame where `cond(arg)` holds. */
async function when<A>(
  page: Page,
  cond: (arg: A) => boolean,
  arg: A,
  timeout = 60_000,
): Promise<number> {
  const h = await page.waitForFunction(
    ({ src, a }) => {
      const f = new Function(`return (${src})`)() as (x: unknown) => boolean;
      return f(a) ? performance.now() : false;
    },
    { src: cond.toString(), a: arg },
    { polling: 'raf', timeout },
  );
  return (await h.jsonValue()) as number;
}
const linkVisible = (href: string) => {
  const a = document.querySelector(`ul[aria-label="Entries"] a[href$="${href}"]`);
  if (!a) return false;
  const r = a.getBoundingClientRect();
  return r.height > 0 && r.top >= 0 && r.bottom <= window.innerHeight;
};

for (const rate of [1, 4]) {
  const mode = rate === 1 ? 'unthrottled' : `cpu${rate}x`;
  for (let run = 0; run < RUNS; run++) {
    test(`listing 10k ${mode} run ${run}`, async ({ page }, info) => {
      test.skip(rate !== 1 && info.project.name !== 'chromium');
      await throttle(page, rate);
      await page.goto(`/browse/perf/big`, { waitUntil: 'commit' });
      record(info, mode, 'nav_to_first_row', await when(page, linkVisible, `/${name(0)}`));
      const entries = page.getByRole('list', { name: 'Entries' });
      await expect(entries.getByRole('listitem').first()).toHaveAttribute(
        'aria-setsize',
        String(COUNT),
      );

      let t0 = await page.evaluate(() => {
        const t = performance.now();
        window.scrollTo(0, document.documentElement.scrollHeight);
        return t;
      });
      record(
        info,
        mode,
        'scroll_end_to_last_visible',
        (await when(page, linkVisible, `/${name(COUNT - 1)}`)) - t0,
      );
      t0 = await page.evaluate(
        (href) => {
          const t = performance.now();
          (
            document.querySelector(`ul[aria-label="Entries"] a[href$="${href}"]`) as HTMLElement
          ).click();
          return t;
        },
        `/${name(COUNT - 1)}`,
      );
      const t1 = await when(
        page,
        (txt) => [...document.querySelectorAll('h1')].some((h) => h.textContent === txt),
        String(COUNT - 1),
      );
      record(info, mode, 'click_last_to_doc', t1 - t0);
      await expect(page.getByRole('heading', { name: String(COUNT - 1) })).toBeVisible();

      // Filter typing latency: keydown -> first frame showing the filtered list.
      await page.goto(`/browse/perf/big`);
      await when(page, linkVisible, `/${name(0)}`);
      const input = page.getByRole('searchbox', { name: 'Filter by name' });
      await input.click();
      await page.evaluate(() => {
        const w = window as unknown as { lastKey: number };
        document.addEventListener('keydown', () => (w.lastKey = performance.now()), true);
      });
      // Expected visible-row counts after each key (all names start with "f0", "f09" leaves 1,000, ...).
      const q = 'f09999';
      const expected = [10000, 10000, 1000, 100, 10, 1];
      const per: number[] = [];
      for (let i = 0; i < q.length; i++) {
        await page.keyboard.press(q[i]);
        const done = await when(
          page,
          ({ v, n }) => {
            const inp = document.querySelector(
              'input[aria-label="Filter by name"]',
            ) as HTMLInputElement;
            const first = document.querySelector('ul[aria-label="Entries"] li');
            const size =
              first?.getAttribute('aria-setsize') ??
              String(document.querySelectorAll('ul[aria-label="Entries"] li').length);
            return inp.value === v && size === String(n);
          },
          { v: q.slice(0, i + 1), n: expected[i] },
        );
        per.push(
          done - (await page.evaluate(() => (window as unknown as { lastKey: number }).lastKey)),
        );
      }
      await expect(entries.getByRole('listitem')).toHaveCount(1);
      record(info, mode, 'filter_key_first(10k rows)', per[0]);
      record(info, mode, 'filter_key_max', Math.max(...per));
      record(info, mode, 'filter_key_mean', per.reduce((a, b) => a + b, 0) / per.length);
    });

    test(`doc 10 diagrams ${mode} run ${run}`, async ({ page }, info) => {
      test.skip(rate !== 1 && info.project.name !== 'chromium');
      // Unique D2 comments per run: the server D2 cache is cold for every measurement.
      const doc = `doc-${String((info.project.name === 'ipad' ? 6 : 0) + (rate === 4 ? 3 : 0) + run).padStart(2, '0')}.md`;
      await throttle(page, rate);
      await page.goto(`/view/perf/${doc}#section-4`, { waitUntil: 'commit' });
      record(
        info,
        mode,
        'doc_nav_to_h1',
        await when(
          page,
          () => [...document.querySelectorAll('h1')].some((h) => h.textContent === 'Perf Doc'),
          null,
        ),
      );
      record(
        info,
        mode,
        'doc_nav_to_code_highlighted',
        await when(page, () => document.querySelectorAll('pre.shiki').length >= 10, null),
      );
      // What the user is looking at: the hash jump to section 4 lands on its Mermaid diagram.
      record(
        info,
        mode,
        'doc_nav_to_viewport_diagrams_ready',
        await when(
          page,
          () => {
            let el = document.getElementById('section-4')?.nextElementSibling ?? null;
            while (el && !el.matches('figure.diagram')) el = el.nextElementSibling;
            if (!el || (el as HTMLElement).dataset.diagram !== 'mermaid') return false;
            const r = el.getBoundingClientRect();
            const img = el.querySelector('img');
            return (
              el.getAttribute('data-state') === 'ready' &&
              !!img?.complete &&
              img.naturalWidth > 0 &&
              r.bottom > 0 &&
              r.top < window.innerHeight
            );
          },
          null,
        ),
      );
      // Informational: every diagram in the document, including far off-screen ones.
      record(
        info,
        mode,
        'doc_nav_to_10_diagrams_ready',
        await when(
          page,
          () => {
            const imgs = [
              ...document.querySelectorAll('figure.diagram[data-state="ready"] img'),
            ] as HTMLImageElement[];
            return imgs.length === 10 && imgs.every((i) => i.complete && i.naturalWidth > 0);
          },
          null,
        ),
      );
      expect(await page.locator('figure.diagram[data-state="error"]').count()).toBe(0);
    });
  }
}
