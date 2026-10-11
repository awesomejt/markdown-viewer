import { useQuery } from '@tanstack/react-query';
import { ApiError, getFile, getList, getRoots } from './client';

/** Stable query keys; F6 invalidates by these (prefix matching works). */
export const queryKeys = {
  roots: () => ['roots'] as const,
  list: (root: string, path: string) => ['list', root, path] as const,
  file: (root: string, path: string, force = false) => ['file', root, path, force] as const,
};

const MAX_RETRIES = 2;

/** Never retry 4xx; retry network errors and 5xx (incl. 504) a couple of times. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
  return failureCount < MAX_RETRIES;
}

export function useRoots() {
  return useQuery({
    queryKey: queryKeys.roots(),
    queryFn: ({ signal }) => getRoots(signal),
    retry: shouldRetry,
  });
}

export function useList(root: string, path: string) {
  return useQuery({
    queryKey: queryKeys.list(root, path),
    queryFn: ({ signal }) => getList(root, path, signal),
    retry: shouldRetry,
  });
}

export function useFile(root: string, path: string, force = false) {
  return useQuery({
    queryKey: queryKeys.file(root, path, force),
    queryFn: ({ signal }) => getFile(root, path, { force, signal }),
    retry: shouldRetry,
  });
}
