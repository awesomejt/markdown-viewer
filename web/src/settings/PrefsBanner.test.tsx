import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import type { PrefsResponse } from '../api/types';
import { BANNER_DISMISS_KEY, bannerSignature, PrefsBanner } from './PrefsBanner';

const base: PrefsResponse = { configured: true, settings: {}, warnings: [], error: null };

function renderBanner(data: PrefsResponse | undefined, client?: QueryClient) {
  const c = client ?? new QueryClient();
  if (data) c.setQueryData(['prefs'], data);
  const ui = (
    <QueryClientProvider client={c}>
      <PrefsBanner />
    </QueryClientProvider>
  );
  const r = render(ui);
  return { client: c, ...r };
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe('PrefsBanner', () => {
  it('renders nothing without problems', () => {
    const { container } = renderBanner(base);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a fatal error with the defaults notice', () => {
    renderBanner({
      ...base,
      error: { code: 'prefs_invalid', message: 'bad yaml', line: 3 },
    });
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Preferences file problem: bad yaml. Using defaults.',
    );
  });

  it('lists warnings with message, key and line in an expandable list', async () => {
    renderBanner({
      ...base,
      warnings: [
        { code: 'unknown_key', message: 'unknown key "foo"', key: 'foo', line: 4 },
        { code: 'invalid_value', message: 'bad size', key: 'settings.fontSize' },
      ],
    });
    const summary = screen.getByText('2 preference warnings');
    expect(summary.tagName).toBe('SUMMARY');
    expect(screen.getByText('unknown key "foo"')).toBeInTheDocument();
    expect(screen.getByText('settings.fontSize')).toBeInTheDocument();
    expect(screen.getByText(/line 4/)).toBeInTheDocument();
  });

  it('uses the singular for one warning', () => {
    renderBanner({ ...base, warnings: [{ code: 'unknown_key', message: 'm' }] });
    expect(screen.getByText('1 preference warning')).toBeInTheDocument();
  });

  it('merges client warnings from an unknown style', () => {
    renderBanner({ ...base, settings: { style: 'fancy' } });
    expect(screen.getByText('1 preference warning')).toBeInTheDocument();
    expect(screen.getByText(/Unknown style "fancy"/)).toBeInTheDocument();
  });

  it('renders message text without interpreting HTML', () => {
    const { container } = renderBanner({
      ...base,
      error: { code: 'prefs_invalid', message: '<img src=x onerror=alert(1)>' },
      warnings: [{ code: 'unknown_key', message: '<b>bold</b>', ref: '<i>x</i>' }],
    });
    expect(container.querySelector('img, b, i')).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent('<img src=x onerror=alert(1)>');
  });

  it('dismisses for the session and keeps it dismissed on remount', async () => {
    const user = userEvent.setup();
    const data = { ...base, warnings: [{ code: 'unknown_key', message: 'm' }] };
    const first = renderBanner(data);
    await user.click(screen.getByRole('button', { name: 'Dismiss preferences notice' }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(window.sessionStorage.getItem(BANNER_DISMISS_KEY)).toBe(
      bannerSignature(null, data.warnings),
    );
    first.unmount();
    renderBanner(data);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows again when the problem is different', async () => {
    const user = userEvent.setup();
    const { client } = renderBanner({
      ...base,
      warnings: [{ code: 'unknown_key', message: 'one' }],
    });
    await user.click(screen.getByRole('button', { name: 'Dismiss preferences notice' }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    act(() =>
      client.setQueryData(['prefs'], {
        ...base,
        warnings: [{ code: 'unknown_key', message: 'two' }],
      }),
    );
    expect(await screen.findByText('two')).toBeInTheDocument();
  });

  it('tolerates sessionStorage failing', async () => {
    const user = userEvent.setup();
    const orig = Storage.prototype.setItem;
    const get = Storage.prototype.getItem;
    Storage.prototype.setItem = () => {
      throw new Error('denied');
    };
    Storage.prototype.getItem = () => {
      throw new Error('denied');
    };
    try {
      renderBanner({ ...base, warnings: [{ code: 'unknown_key', message: 'm' }] });
      await user.click(screen.getByRole('button', { name: 'Dismiss preferences notice' }));
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    } finally {
      Storage.prototype.setItem = orig;
      Storage.prototype.getItem = get;
    }
  });
});

describe('bannerSignature', () => {
  it('differs for different content and is stable for the same', () => {
    const a = bannerSignature(null, [{ code: 'x', message: 'one' }]);
    expect(a).toBe(bannerSignature(null, [{ code: 'x', message: 'one' }]));
    expect(a).not.toBe(bannerSignature(null, [{ code: 'x', message: 'two' }]));
    expect(a).not.toBe(bannerSignature({ code: 'e', message: 'one' }, []));
  });
});
