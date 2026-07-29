import assert from 'node:assert/strict';
import {
  LifecycleScopeDisposedError,
  createLifecycleDiagnostics,
  createLifecycleScope,
} from '../src/infrastructure/lifecycle-scope.js';

function createTimers() {
  let nextId = 1;
  const timeouts = new Map();
  const intervals = new Map();
  return {
    setTimeout(handler) { const id = nextId++; timeouts.set(id, handler); return id; },
    clearTimeout(id) { timeouts.delete(id); },
    setInterval(handler) { const id = nextId++; intervals.set(id, handler); return id; },
    clearInterval(id) { intervals.delete(id); },
    fireTimeout(id) { const handler = timeouts.get(id); timeouts.delete(id); handler?.(); },
    tickInterval(id) { intervals.get(id)?.(); },
    get timeoutCount() { return timeouts.size; },
    get intervalCount() { return intervals.size; },
  };
}

class FakeEventTarget {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(handler);
  }
  removeEventListener(type, handler) { this.listeners.get(type)?.delete(handler); }
  emit(type) { for (const handler of this.listeners.get(type) || []) handler(); }
  count(type) { return this.listeners.get(type)?.size || 0; }
}


{
  const diagnostics = createLifecycleDiagnostics();
  const scope = createLifecycleScope({ label: 'idempotent', diagnostics });
  let cleanups = 0;
  scope.addCleanup(() => { cleanups += 1; });
  assert.deepEqual(diagnostics.snapshot(), { cleanup: 1, scope: 1 });
  assert.equal(scope.dispose('test'), true);
  assert.equal(scope.dispose('again'), false);
  assert.equal(cleanups, 1);
  assert.equal(scope.signal.reason, 'test');
  assert.deepEqual(diagnostics.snapshot(), {});
  assert.throws(() => scope.addCleanup(() => {}), LifecycleScopeDisposedError);
}

{
  const diagnostics = createLifecycleDiagnostics();
  const parent = createLifecycleScope({ label: 'parent', diagnostics });
  const child = parent.child('child');
  assert.equal(child.label, 'parent/child');
  assert.deepEqual(diagnostics.snapshot(), { 'child-scope': 1, scope: 2 });
  parent.dispose('parent-test');
  assert.equal(child.isDisposed, true);
  assert.equal(child.signal.reason, 'parent-test');
  assert.deepEqual(diagnostics.snapshot(), {});
}

{
  const timers = createTimers();
  const diagnostics = createLifecycleDiagnostics();
  const scope = createLifecycleScope({ label: 'timers', diagnostics, timers });
  let timeoutRuns = 0;
  let intervalRuns = 0;
  const timeout = scope.timeout(() => { timeoutRuns += 1; }, 10);
  const interval = scope.interval(() => { intervalRuns += 1; }, 10);
  assert.deepEqual(diagnostics.snapshot(), { interval: 1, scope: 1, timeout: 1 });
  timers.fireTimeout(timeout.id);
  timers.tickInterval(interval.id);
  assert.equal(timeoutRuns, 1);
  assert.equal(intervalRuns, 1);
  assert.deepEqual(diagnostics.snapshot(), { interval: 1, scope: 1 });
  scope.dispose();
  assert.equal(timers.timeoutCount, 0);
  assert.equal(timers.intervalCount, 0);
  timers.tickInterval(interval.id);
  assert.equal(intervalRuns, 1);
  assert.deepEqual(diagnostics.snapshot(), {});
}

{
  const diagnostics = createLifecycleDiagnostics();
  const scope = createLifecycleScope({ label: 'controller', diagnostics });
  const controller = scope.abortController();
  assert.deepEqual(diagnostics.snapshot(), { controller: 1, scope: 1 });
  controller.abort('external');
  assert.deepEqual(diagnostics.snapshot(), { scope: 1 });
  scope.dispose();
  assert.equal(controller.signal.reason, 'external');
  assert.deepEqual(diagnostics.snapshot(), {});
}

{
  const diagnostics = createLifecycleDiagnostics();
  const parent = createLifecycleScope({ label: 'disposed-parent', diagnostics });
  parent.dispose();
  assert.throws(() => parent.child('orphan'), LifecycleScopeDisposedError);
  assert.throws(
    () => createLifecycleScope({ label: 'orphan', parent, diagnostics }),
    LifecycleScopeDisposedError,
  );
  assert.deepEqual(diagnostics.snapshot(), {});
}

{
  const diagnostics = createLifecycleDiagnostics();
  const parent = createLifecycleScope({ label: 'error-parent', diagnostics });
  const first = parent.child('first');
  const second = parent.child('second');
  let completedCleanup = false;
  first.addCleanup(() => { throw new Error('first-cleanup-failed'); });
  second.addCleanup(() => { completedCleanup = true; });
  assert.throws(
    () => parent.dispose(),
    error => error instanceof AggregateError
      && error.errors.some(childError => childError instanceof AggregateError),
  );
  assert.equal(completedCleanup, true);
  assert.equal(first.isDisposed, true);
  assert.equal(second.isDisposed, true);
  assert.deepEqual(diagnostics.snapshot(), {});
}

{
  const diagnostics = createLifecycleDiagnostics();
  const scope = createLifecycleScope({ label: 'listener', diagnostics });
  const target = new FakeEventTarget();
  let events = 0;
  const release = scope.listen(target, 'change', () => { events += 1; });
  assert.equal(target.count('change'), 1);
  target.emit('change');
  assert.equal(events, 1);
  assert.equal(release(), true);
  assert.equal(release(), false);
  assert.equal(target.count('change'), 0);
  scope.dispose();
  target.emit('change');
  assert.equal(events, 1);
  assert.deepEqual(diagnostics.snapshot(), {});
}

{
  const timers = createTimers();
  const diagnostics = createLifecycleDiagnostics();
  const scope = createLifecycleScope({ label: 'manual-cancel', diagnostics, timers });
  let runs = 0;
  const timeout = scope.timeout(() => { runs += 1; }, 10);
  const interval = scope.interval(() => { runs += 1; }, 10);
  assert.equal(timeout.cancel(), true);
  assert.equal(timeout.cancel(), false);
  assert.equal(interval.cancel(), true);
  assert.equal(interval.cancel(), false);
  timers.fireTimeout(timeout.id);
  timers.tickInterval(interval.id);
  assert.equal(runs, 0);
  assert.deepEqual(diagnostics.snapshot(), { scope: 1 });
  scope.dispose();
  assert.deepEqual(diagnostics.snapshot(), {});
}

{
  const scope = createLifecycleScope({ label: 'scope-controller' });
  const controller = scope.abortController();
  scope.dispose('scope-ended');
  assert.equal(controller.signal.aborted, true);
  assert.equal(controller.signal.reason, 'scope-ended');
}

{
  const scope = createLifecycleScope({ label: 'rejected-apis' });
  const target = new FakeEventTarget();
  const pending = scope.run(() => assert.fail('disposed scope task must not run'));
  scope.dispose();
  await assert.rejects(pending, LifecycleScopeDisposedError);
  for (const operation of [
    () => scope.listen(target, 'event', () => {}),
    () => scope.timeout(() => {}, 0),
    () => scope.interval(() => {}, 0),
    () => scope.abortController(),
    () => scope.child('late'),
    () => scope.run(() => {}),
  ]) assert.throws(operation, LifecycleScopeDisposedError);
}

console.log('Lifecycle scope behavior verified.');
