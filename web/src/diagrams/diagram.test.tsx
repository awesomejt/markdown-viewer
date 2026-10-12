import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DiagramBoundary } from './Diagram';

function Boom(): never {
  throw new Error('kaboom');
}

describe('DiagramBoundary', () => {
  it('shows the error box and leaves siblings alone', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { rerender } = render(
      <div>
        <p>sibling</p>
        <DiagramBoundary kind="d2" source="a -> b">
          <Boom />
        </DiagramBoundary>
      </div>,
    );
    expect(screen.getByText('sibling')).toBeInTheDocument();
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('D2 diagram error');
    expect(alert).toHaveTextContent('kaboom');
    expect(alert.querySelector('pre code')?.textContent).toBe('a -> b');

    // A changed source resets the boundary.
    rerender(
      <div>
        <p>sibling</p>
        <DiagramBoundary kind="d2" source="c -> d">
          <span>fine now</span>
        </DiagramBoundary>
      </div>,
    );
    expect(screen.getByText('fine now')).toBeInTheDocument();
    spy.mockRestore();
  });
});
