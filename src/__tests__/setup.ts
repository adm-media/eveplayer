/*
 * Copyright 2026 ADM Media Consulting SA
 * SPDX-License-Identifier: Apache-2.0
 */
// jsdom does not implement PointerEvent. Provide a minimal polyfill
// so drag-interaction tests can dispatch pointer events.
if (typeof PointerEvent === 'undefined') {
  class PointerEvent extends MouseEvent {
    readonly pointerId: number;

    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params);
      this.pointerId = params.pointerId ?? 0;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).PointerEvent = PointerEvent;
}
