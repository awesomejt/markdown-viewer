import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';
import { resetDeviceCaches } from '../settings/device';

// Vitest globals are off, so RTL's automatic cleanup is not registered.
afterEach(() => cleanup());

// Device choices are cached per store; every test starts from what storage holds.
beforeEach(() => resetDeviceCaches());
