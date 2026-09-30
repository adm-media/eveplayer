/*
 * Copyright 2026 ADM Media Consulting SA
 * SPDX-License-Identifier: Apache-2.0
 */
import type { PlayerEventMap } from './types';

type Handler<T> = T extends void ? () => void : (data: T) => void;

type HandlerMap = {
  [K in keyof PlayerEventMap]?: Set<Handler<PlayerEventMap[K]>>;
};

/**
 * Small typed pub/sub used internally by {@link EvePlayer}. `on`/`off`/
 * `once` on the player delegate straight to an instance of this class; payload
 * types come from {@link PlayerEventMap}. Not part of the public API.
 */
export class EventEmitter {
  private readonly handlers: HandlerMap = {};

  /** Register `handler` for `event`. Adding the same handler twice is a no-op. */
  on<K extends keyof PlayerEventMap>(event: K, handler: Handler<PlayerEventMap[K]>): void {
    if (!this.handlers[event]) {
      (this.handlers as Record<string, Set<unknown>>)[event] = new Set();
    }
    (this.handlers[event] as Set<Handler<PlayerEventMap[K]>>).add(handler);
  }

  /** Remove a previously registered handler (matched by reference). */
  off<K extends keyof PlayerEventMap>(event: K, handler: Handler<PlayerEventMap[K]>): void {
    this.handlers[event]?.delete(handler);
  }

  /** Register `handler` for a single firing of `event`, then auto-remove it. */
  once<K extends keyof PlayerEventMap>(event: K, handler: Handler<PlayerEventMap[K]>): void {
    const wrapper = (...args: unknown[]) => {
      this.off(event, wrapper as Handler<PlayerEventMap[K]>);
      (handler as (...a: unknown[]) => void)(...args);
    };
    this.on(event, wrapper as Handler<PlayerEventMap[K]>);
  }

  /** Invoke every handler registered for `event` with the given payload (if any). */
  emit<K extends keyof PlayerEventMap>(
    event: K,
    ...args: PlayerEventMap[K] extends void ? [] : [PlayerEventMap[K]]
  ): void {
    const set = this.handlers[event];
    if (!set) return;
    for (const handler of set) {
      (handler as (...a: unknown[]) => void)(...args);
    }
  }

  /** Drop every handler for every event. */
  removeAll(): void {
    for (const key of Object.keys(this.handlers) as (keyof PlayerEventMap)[]) {
      delete this.handlers[key];
    }
  }
}
