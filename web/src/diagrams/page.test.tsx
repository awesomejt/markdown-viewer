import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { diagramKindOf } from './DiagramPage';
import DiagramPage from './DiagramPage';
import { renderWithClient } from './test-utils';

vi.mock('./mermaid', () => ({ renderMermaid: vi.fn(async () => '<svg/>') }));

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:page');
  URL.revokeObjectURL = vi.fn();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.includes('missing')) {
        return Response.json({ error: { code: 'not_found', message: 'nope' } }, { status: 404 });
      }
      return new Response('graph TD\n A-->B');
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('DiagramPage', () => {
  it('maps extensions to kinds', () => {
    expect(diagramKindOf('a/b.D2')).toBe('d2');
    expect(diagramKindOf('a/b.mmd')).toBe('mermaid');
    expect(diagramKindOf('a/b.mermaid')).toBe('mermaid');
  });

  it('renders heading and diagram', async () => {
    renderWithClient(<DiagramPage root="r" path="diagrams/flow.mmd" />);
    expect(await screen.findByRole('heading', { name: 'flow.mmd' })).toBeInTheDocument();
    expect(await screen.findByRole('img', { name: 'Mermaid diagram' })).toBeInTheDocument();
  });

  it('shows an error state when the file is missing', async () => {
    renderWithClient(<DiagramPage root="r" path="missing.mmd" />);
    expect(await screen.findByText('Not found')).toBeInTheDocument();
  });
});
