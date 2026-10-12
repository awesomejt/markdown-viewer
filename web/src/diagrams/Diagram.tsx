import { Component, type ReactNode } from 'react';
import D2Diagram from './D2Diagram';
import DiagramError from './DiagramError';
import type { DiagramKind } from './kinds';
import MermaidDiagram from './MermaidDiagram';

export type { DiagramKind } from './kinds';

interface BoundaryProps {
  kind: DiagramKind;
  source: string;
  children: ReactNode;
}

/** Keeps a crashing diagram from taking the page down. */
export class DiagramBoundary extends Component<BoundaryProps, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidUpdate(prev: BoundaryProps) {
    if (this.state.error && (prev.source !== this.props.source || prev.kind !== this.props.kind)) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      return (
        <figure className="diagram" data-diagram={this.props.kind} data-state="error">
          <DiagramError
            kind={this.props.kind}
            message={this.state.error.message || 'The diagram could not be displayed.'}
            source={this.props.source}
          />
        </figure>
      );
    }
    return this.props.children;
  }
}

export default function Diagram({ kind, source }: { kind: DiagramKind; source: string }) {
  return (
    <DiagramBoundary kind={kind} source={source}>
      {kind === 'mermaid' ? <MermaidDiagram source={source} /> : <D2Diagram source={source} />}
    </DiagramBoundary>
  );
}
