import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Tracer } from '../src/tracer.mjs';
import { Clock } from '../src/clock.mjs';

describe('Tracer', () => {
  it('emit auto-stamps with id and timestamp', () => {
    const clock = Clock.fixed(1000, 2000);
    const tracer = new Tracer({ clock });
    tracer.emit({ type: 'test', data: 'hello' });
    const events = tracer.snapshot();
    assert.equal(events.length, 1);
    assert.equal(events[0].id, 1);
    assert.equal(events[0].timestamp, 1000);
    assert.equal(events[0].type, 'test');
    assert.equal(events[0].data, 'hello');
  });

  it('incrementing IDs', () => {
    const tracer = new Tracer();
    tracer.emit({ type: 'a' });
    tracer.emit({ type: 'b' });
    tracer.emit({ type: 'c' });
    const events = tracer.snapshot();
    assert.equal(events[0].id, 1);
    assert.equal(events[1].id, 2);
    assert.equal(events[2].id, 3);
  });

  it('evict-half at capacity', () => {
    const tracer = new Tracer({ capacity: 4 });
    for (let i = 0; i < 5; i++) tracer.emit({ type: 'x', i });
    const events = tracer.snapshot();
    // After 5 events with capacity 4, evict-half keeps last 2
    assert.ok(events.length <= 4);
    assert.ok(events.length >= 2);
    // Last event should still be present
    assert.equal(events[events.length - 1].i, 4);
  });

  it('snapshot returns copy', () => {
    const tracer = new Tracer();
    tracer.emit({ type: 'a' });
    const snap1 = tracer.snapshot();
    tracer.emit({ type: 'b' });
    const snap2 = tracer.snapshot();
    assert.equal(snap1.length, 1);
    assert.equal(snap2.length, 2);
  });

  it('clear removes events', () => {
    const tracer = new Tracer();
    tracer.emit({ type: 'a' });
    tracer.clear();
    assert.equal(tracer.snapshot().length, 0);
  });

  it('events() async iterable receives new events', async () => {
    const tracer = new Tracer();
    const iter = tracer.events()[Symbol.asyncIterator]();

    // Emit after starting iteration
    queueMicrotask(() => tracer.emit({ type: 'hello' }));

    const result = await iter.next();
    assert.equal(result.done, false);
    assert.equal(result.value.type, 'hello');
    await iter.return();
  });

  it('multiple consumers get independent events', async () => {
    const tracer = new Tracer();
    const iter1 = tracer.events()[Symbol.asyncIterator]();
    const iter2 = tracer.events()[Symbol.asyncIterator]();

    queueMicrotask(() => tracer.emit({ type: 'shared' }));

    const [r1, r2] = await Promise.all([iter1.next(), iter2.next()]);
    assert.equal(r1.value.type, 'shared');
    assert.equal(r2.value.type, 'shared');
    await iter1.return();
    await iter2.return();
  });
});
