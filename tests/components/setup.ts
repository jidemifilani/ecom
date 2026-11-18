import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

/**
 * Component test environment.
 *
 * jsdom lacks a few browser APIs that Radix primitives and the theme toggle
 * rely on, so they are stubbed here rather than in each test.
 */

afterEach(() => {
  cleanup();
});

// Radix uses ResizeObserver for positioning.
globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
} as unknown as typeof ResizeObserver;

// jsdom does not implement matchMedia, which the theme toggle reads.
if (!window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

// Radix Dialog checks for these during focus management.
globalThis.DOMRect ??= class {
  constructor(
    public x = 0,
    public y = 0,
    public width = 0,
    public height = 0,
  ) {}
  get top(): number {
    return this.y;
  }
  get left(): number {
    return this.x;
  }
  get right(): number {
    return this.x + this.width;
  }
  get bottom(): number {
    return this.y + this.height;
  }
  static fromRect(): DOMRect {
    return new DOMRect();
  }
  toJSON(): unknown {
    return {};
  }
} as unknown as typeof DOMRect;

Element.prototype.scrollIntoView ??= (): void => {};
