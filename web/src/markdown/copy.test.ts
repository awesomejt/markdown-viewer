import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyText } from './copy';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stubClipboard(secure: boolean, writeText?: (t: string) => Promise<void>) {
  vi.stubGlobal('isSecureContext', secure);
  vi.stubGlobal('navigator', { ...navigator, clipboard: writeText ? { writeText } : undefined });
}

function stubExec(result: boolean | Error) {
  const exec = vi.fn(() => {
    if (result instanceof Error) throw result;
    return result;
  });
  Object.defineProperty(document, 'execCommand', { value: exec, configurable: true });
  return exec;
}

describe('copyText', () => {
  it('uses the async clipboard in a secure context', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    stubClipboard(true, writeText);
    const exec = stubExec(true);
    await expect(copyText('abc')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('abc');
    expect(exec).not.toHaveBeenCalled();
  });

  it('falls back to a selected textarea over plain HTTP', async () => {
    stubClipboard(false);
    let copied = '';
    const exec = stubExec(true);
    exec.mockImplementation(() => {
      const area = document.querySelector('textarea');
      copied = area?.value.slice(area.selectionStart, area.selectionEnd) ?? '';
      return true;
    });
    await expect(copyText('line 1\nline 2')).resolves.toBe(true);
    expect(exec).toHaveBeenCalledWith('copy');
    expect(copied).toBe('line 1\nline 2');
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('falls back when the async clipboard rejects', async () => {
    stubClipboard(true, () => Promise.reject(new Error('denied')));
    const exec = stubExec(true);
    await expect(copyText('x')).resolves.toBe(true);
    expect(exec).toHaveBeenCalledWith('copy');
  });

  it('reports failure when the fallback fails or throws', async () => {
    stubClipboard(false);
    stubExec(false);
    await expect(copyText('x')).resolves.toBe(false);
    stubExec(new Error('nope'));
    await expect(copyText('x')).resolves.toBe(false);
    expect(document.querySelector('textarea')).toBeNull();
  });
});
