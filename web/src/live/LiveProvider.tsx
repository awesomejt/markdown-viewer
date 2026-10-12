import { useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { LiveController } from './controller';

const LiveContext = createContext<LiveController | null>(null);

/** Mount inside the QueryClientProvider: owns the tab's one EventSource. */
export function LiveProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [controller] = useState(() => new LiveController({ queryClient }));
  useEffect(() => {
    controller.start();
    return () => controller.stop();
  }, [controller]);
  return <LiveContext.Provider value={controller}>{children}</LiveContext.Provider>;
}

/**
 * Watch `root:path` (a file, or a folder for its direct children) while the component is mounted.
 * `low` subscriptions yield to the others when the per-stream cap is reached.
 */
export function useLiveSubscription(root: string, path: string, low = false): void {
  const controller = useContext(LiveContext);
  useEffect(() => controller?.subscribe(root, path, low), [controller, root, path, low]);
}
