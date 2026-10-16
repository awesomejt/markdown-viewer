import { useSyncExternalStore } from 'react';
import {
  setTextScale,
  TEXT_SCALE_MAX,
  TEXT_SCALE_MIN,
  TEXT_SCALE_STEP,
  textScaleStore,
} from './device';

/** The current text scale in percent (100 when there is no choice). */
export function useTextScalePercent(): number {
  return useSyncExternalStore(textScaleStore.subscribe, textScaleStore.get) ?? 100;
}

export const currentPercent = (): number => textScaleStore.get() ?? 100;

/** One step larger; at the limit nothing changes. */
export function increaseTextScale(): void {
  const p = currentPercent();
  if (p < TEXT_SCALE_MAX) setTextScale(p + TEXT_SCALE_STEP);
}

/** One step smaller; at the limit nothing changes. */
export function decreaseTextScale(): void {
  const p = currentPercent();
  if (p > TEXT_SCALE_MIN) setTextScale(p - TEXT_SCALE_STEP);
}

export function resetTextScale(): void {
  setTextScale(undefined);
}
