import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DiagramPage, { diagramKindOf } from './DiagramPage';
import { renderWithClient } from './test-utils';

vi.mock('./mermaid', () => ({ renderMermaid: vi.fn(async () => '<svg/>') }));

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:page');
  URL.revokeObjectURL = vi.fn();
});

describe('DiagramPage', () => {
  it('maps extensions to kinds', () => {
    expect(diagramKindOf('a/b.D2')).toBe('d2');
    expect(diagramKindOf('a/b.mmd')).toBe('mermaid');
    expect(diagramKindOf('a/b.mermaid')).toBe('mermaid');
  });

  it('renders heading and diagram', async () => {
    renderWithClient(<DiagramPage path="diagrams/flow.mmd" source={'graph TD\n A-->B'} />);
    expect(await screen.findByRole('heading', { name: 'flow.mmd' })).toBeInTheDocument();
    expect(await screen.findByRole('img', { name: 'Mermaid diagram' })).toBeInTheDocument();
  });
});
