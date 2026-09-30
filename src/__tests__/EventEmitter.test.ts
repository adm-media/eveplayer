/*
 * Copyright 2026 ADM Media Consulting SA
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from '../EventEmitter';

describe('EventEmitter', () => {
  it('calls registered handler on emit', () => {
    const emitter = new EventEmitter();
    const handler = vi.fn();
    emitter.on('play', handler);
    emitter.emit('play');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('supports multiple handlers per event', () => {
    const emitter = new EventEmitter();
    const h1 = vi.fn();
    const h2 = vi.fn();
    emitter.on('pause', h1);
    emitter.on('pause', h2);
    emitter.emit('pause');
    expect(h1).toHaveBeenCalledTimes(1);
    expect(h2).toHaveBeenCalledTimes(1);
  });

  it('passes data to handler', () => {
    const emitter = new EventEmitter();
    const handler = vi.fn();
    emitter.on('timeupdate', handler);
    emitter.emit('timeupdate', { currentTime: 42 });
    expect(handler).toHaveBeenCalledWith({ currentTime: 42 });
  });

  it('off() removes the handler by reference', () => {
    const emitter = new EventEmitter();
    const handler = vi.fn();
    emitter.on('play', handler);
    emitter.off('play', handler);
    emitter.emit('play');
    expect(handler).not.toHaveBeenCalled();
  });

  it('off() does not affect other handlers for the same event', () => {
    const emitter = new EventEmitter();
    const h1 = vi.fn();
    const h2 = vi.fn();
    emitter.on('play', h1);
    emitter.on('play', h2);
    emitter.off('play', h1);
    emitter.emit('play');
    expect(h1).not.toHaveBeenCalled();
    expect(h2).toHaveBeenCalledTimes(1);
  });

  it('once() fires exactly once', () => {
    const emitter = new EventEmitter();
    const handler = vi.fn();
    emitter.once('play', handler);
    emitter.emit('play');
    emitter.emit('play');
    emitter.emit('play');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('once() with data fires exactly once with correct data', () => {
    const emitter = new EventEmitter();
    const handler = vi.fn();
    emitter.once('timeupdate', handler);
    emitter.emit('timeupdate', { currentTime: 5 });
    emitter.emit('timeupdate', { currentTime: 10 });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ currentTime: 5 });
  });

  it('emit does nothing when no handlers are registered', () => {
    const emitter = new EventEmitter();
    expect(() => emitter.emit('play')).not.toThrow();
  });

  it('removeAll() clears all listeners', () => {
    const emitter = new EventEmitter();
    const handler = vi.fn();
    emitter.on('play', handler);
    emitter.on('pause', handler);
    emitter.removeAll();
    emitter.emit('play');
    emitter.emit('pause');
    expect(handler).not.toHaveBeenCalled();
  });
});
