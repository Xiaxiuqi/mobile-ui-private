import assert from 'node:assert/strict';
import { bindPressGesture } from '../src/press-gesture.js';

class FakeElement {
  constructor() { this.listeners = new Map(); this.disabled = false; this.captured = []; this.released = []; }
  addEventListener(type, handler) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(handler); }
  removeEventListener(type, handler) { this.listeners.get(type)?.delete(handler); }
  setPointerCapture(pointerId) { this.captured.push(pointerId); }
  releasePointerCapture(pointerId) { this.released.push(pointerId); }
  emit(type, fields = {}) {
    const event = {
      button: 0, pointerId: 1, pointerType: 'mouse', clientX: 0, clientY: 0,
      prevented: false, stopped: false,
      preventDefault() { this.prevented = true; },
      stopPropagation() { this.stopped = true; },
      ...fields,
    };
    for (const handler of this.listeners.get(type) || []) handler(event);
    return event;
  }
}

function createTimers() {
  let nextId = 1; const tasks = new Map();
  return {
    setTimer(fn) { const id = nextId++; tasks.set(id, fn); return id; },
    clearTimer(id) { tasks.delete(id); },
    runAll() { const queued = [...tasks.values()]; tasks.clear(); queued.forEach(fn => fn()); },
    get size() { return tasks.size; },
  };
}

{
  const element = new FakeElement(); const timers = createTimers(); let presses = 0; let holds = 0;
  const unbind = bindPressGesture(element, { onPress: () => presses++, onHold: () => holds++, setTimer: timers.setTimer, clearTimer: timers.clearTimer });
  element.emit('pointerdown'); assert.deepEqual(element.captured, [1]); assert.equal(timers.size, 1);
  element.emit('pointerup'); assert.deepEqual(element.released, [1]); assert.equal(timers.size, 0);
  element.emit('click'); assert.equal(presses, 1); assert.equal(holds, 0);
  unbind(); assert.equal(element.listeners.get('click').size, 0);
}
{
  const element = new FakeElement(); const timers = createTimers(); let presses = 0; let holds = 0;
  bindPressGesture(element, { onPress: () => presses++, onHold: () => holds++, setTimer: timers.setTimer, clearTimer: timers.clearTimer });
  element.emit('pointerdown', { pointerId: 7 }); timers.runAll(); assert.equal(holds, 1);
  element.emit('pointercancel', { pointerId: 7 });
  assert.deepEqual(element.released, [7]);
  const click = element.emit('click', { pointerId: 7 }); assert.equal(click.prevented, true); assert.equal(click.stopped, true); assert.equal(presses, 0);
}
{
  const element = new FakeElement(); const timers = createTimers(); let holds = 0;
  bindPressGesture(element, { onHold: () => holds++, setTimer: timers.setTimer, clearTimer: timers.clearTimer });
  element.emit('pointerdown'); element.emit('pointercancel'); timers.runAll(); assert.equal(holds, 0);
  element.emit('pointerdown', { pointerId: 2 }); element.emit('lostpointercapture', { pointerId: 2 }); timers.runAll(); assert.equal(holds, 0);
}
{
  const element = new FakeElement(); const timers = createTimers(); let presses = 0; let holds = 0;
  bindPressGesture(element, { onPress: () => presses++, onHold: () => holds++, setTimer: timers.setTimer, clearTimer: timers.clearTimer });
  element.emit('pointerdown', { pointerId: 3 }); timers.runAll(); element.emit('lostpointercapture', { pointerId: 3 }); assert.equal(holds, 1);
  element.emit('pointerdown', { pointerId: 4 }); element.emit('pointerup', { pointerId: 4 }); element.emit('click', { pointerId: 4 });
  assert.equal(presses, 1); assert.equal(holds, 1);
}
{
  const element = new FakeElement(); const timers = createTimers(); let holds = 0;
  const unbind = bindPressGesture(element, { onHold: () => holds++, setTimer: timers.setTimer, clearTimer: timers.clearTimer });
  element.emit('pointerdown', { pointerId: 5 }); assert.equal(timers.size, 1); unbind();
  assert.deepEqual(element.released, [5]); assert.equal(timers.size, 0); timers.runAll(); assert.equal(holds, 0);
}
{
  const element = new FakeElement(); const timers = createTimers(); let holds = 0;
  bindPressGesture(element, { onHold: () => holds++, setTimer: timers.setTimer, clearTimer: timers.clearTimer });
  element.emit('pointerdown', { pointerId: 6 });
  element.emit('pointercancel', { pointerId: 99 }); assert.equal(timers.size, 1);
  timers.runAll(); assert.equal(holds, 1);
}
{
  const element = new FakeElement(); const timers = createTimers(); let presses = 0; let holds = 0;
  bindPressGesture(element, { onPress: () => presses++, onHold: () => holds++, setTimer: timers.setTimer, clearTimer: timers.clearTimer });
  element.emit('pointerdown', { pointerId: 8 }); timers.runAll(); element.emit('pointercancel', { pointerId: 8 });
  element.emit('pointerdown', { pointerId: 9 }); element.emit('pointerup', { pointerId: 9 }); element.emit('click', { pointerId: 9 });
  assert.equal(holds, 1); assert.equal(presses, 1);
}
for (const pointerType of ['mouse', 'touch', 'pen']) {
  const element = new FakeElement(); const eventTarget = new FakeElement(); const timers = createTimers(); let holds = 0;
  bindPressGesture(element, { onHold: () => holds++, setTimer: timers.setTimer, clearTimer: timers.clearTimer, eventTarget, moveThreshold: 10 });
  element.emit('pointerdown', { pointerId: 20, pointerType, clientX: 10, clientY: 10 });
  element.emit('pointermove', { pointerId: 20, pointerType, clientX: 16, clientY: 18 });
  timers.runAll(); assert.equal(holds, 1, `${pointerType}: movement at threshold must preserve hold`);
}
{
  const element = new FakeElement(); const eventTarget = new FakeElement(); const timers = createTimers(); let presses = 0; let holds = 0;
  bindPressGesture(element, { onPress: () => presses++, onHold: () => holds++, setTimer: timers.setTimer, clearTimer: timers.clearTimer, eventTarget, moveThreshold: 10 });
  element.emit('pointerdown', { pointerId: 21, clientX: 5, clientY: 5 });
  element.emit('pointermove', { pointerId: 21, clientX: 16, clientY: 5 });
  assert.deepEqual(element.released, [21]);
  assert.equal(timers.size, 0); timers.runAll(); assert.equal(holds, 0);
  const click = element.emit('click', { pointerId: 21 });
  assert.equal(click.prevented, true); assert.equal(presses, 0);
}
{
  const element = new FakeElement(); const eventTarget = new FakeElement(); const timers = createTimers(); let presses = 0; let holds = 0;
  bindPressGesture(element, { onPress: () => presses++, onHold: () => holds++, setTimer: timers.setTimer, clearTimer: timers.clearTimer, eventTarget });
  element.emit('pointerdown', { pointerId: 22 }); eventTarget.emit('blur');
  assert.deepEqual(element.released, [22]);
  assert.equal(timers.size, 0); timers.runAll(); assert.equal(holds, 0);
  const click = element.emit('click', { pointerId: 22 });
  assert.equal(click.prevented, true); assert.equal(presses, 0);
}
for (const cancelEvent of ['pointercancel', 'lostpointercapture']) {
  const element = new FakeElement(); const eventTarget = new FakeElement(); const timers = createTimers(); let presses = 0;
  bindPressGesture(element, { onPress: () => presses++, setTimer: timers.setTimer, clearTimer: timers.clearTimer, eventTarget });
  element.emit('pointerdown', { pointerId: 23 }); element.emit(cancelEvent, { pointerId: 23 });
  const click = element.emit('click', { pointerId: 23 });
  assert.equal(click.prevented, true, `${cancelEvent}: synthesized click must be suppressed`);
  assert.equal(presses, 0);
}
{
  const element = new FakeElement(); const eventTarget = new FakeElement(); const timers = createTimers(); let presses = 0; let holds = 0;
  bindPressGesture(element, { onPress: () => presses++, onHold: () => holds++, setTimer: timers.setTimer, clearTimer: timers.clearTimer, eventTarget });
  element.emit('pointerdown', { pointerId: 24 }); timers.runAll();
  element.emit('pointerup', { pointerId: 24 });
  const legacyClick = element.emit('click', { pointerId: undefined, detail: 1 });
  assert.equal(legacyClick.prevented, true); assert.equal(legacyClick.stopped, true);
  assert.equal(holds, 1); assert.equal(presses, 0, 'legacy pointer click after hold must not trigger short press');
}
{
  const element = new FakeElement(); const eventTarget = new FakeElement(); const timers = createTimers(); let presses = 0;
  bindPressGesture(element, { onPress: () => presses++, setTimer: timers.setTimer, clearTimer: timers.clearTimer, eventTarget });
  element.emit('pointerdown', { pointerId: 25 }); element.emit('pointercancel', { pointerId: 25 });
  const legacyClick = element.emit('click', { pointerId: undefined, detail: 1 });
  assert.equal(legacyClick.prevented, true); assert.equal(presses, 0, 'legacy pointer click after cancel must not trigger short press');
  element.emit('pointerdown', { pointerId: 26 }); element.emit('pointerup', { pointerId: 26 });
  element.emit('click', { pointerId: undefined, detail: 1 });
  assert.equal(presses, 1, 'a later normal pointer press must remain available without retained suppression state');
}
{
  const element = new FakeElement(); const eventTarget = new FakeElement(); const timers = createTimers(); let presses = 0;
  bindPressGesture(element, { onPress: () => presses++, setTimer: timers.setTimer, clearTimer: timers.clearTimer, eventTarget });
  element.emit('pointerdown', { pointerId: 27 }); element.emit('pointerup', { pointerId: 27 });
  element.emit('click', { pointerId: 27, detail: 1 });
  assert.equal(presses, 1, 'pointerup and synthesized click must produce exactly one short press');
}
{
  const element = new FakeElement(); const eventTarget = new FakeElement(); const timers = createTimers(); let presses = 0;
  bindPressGesture(element, { onPress: () => presses++, setTimer: timers.setTimer, clearTimer: timers.clearTimer, eventTarget });
  element.emit('click', { pointerId: undefined, detail: 0 });
  assert.equal(presses, 1, 'keyboard click must remain available');
}
{
  const element = new FakeElement(); const eventTarget = new FakeElement(); const timers = createTimers(); let presses = 0;
  element.releasePointerCapture = pointerId => {
    element.released.push(pointerId);
    element.emit('lostpointercapture', { pointerId });
  };
  bindPressGesture(element, { onPress: () => presses++, setTimer: timers.setTimer, clearTimer: timers.clearTimer, eventTarget });
  element.emit('pointerdown', { pointerId: 28 });
  element.emit('pointerup', { pointerId: 28 });
  assert.deepEqual(element.released, [28], 'synchronous lostpointercapture re-entry must not release twice');
  assert.equal(presses, 1, 'synchronous lostpointercapture re-entry must not duplicate short press');
  assert.equal(timers.size, 0);
}
{
  const element = new FakeElement(); const eventTarget = new FakeElement(); const timers = createTimers(); let presses = 0;
  const deferredLost = [];
  element.releasePointerCapture = pointerId => {
    element.released.push(pointerId);
    deferredLost.push(() => element.emit('lostpointercapture', { pointerId }));
  };
  bindPressGesture(element, { onPress: () => presses++, setTimer: timers.setTimer, clearTimer: timers.clearTimer, eventTarget });
  element.emit('pointerdown', { pointerId: 29 });
  element.emit('pointerup', { pointerId: 29 });
  deferredLost.splice(0).forEach(dispatch => dispatch());
  assert.deepEqual(element.released, [29], 'deferred lostpointercapture must not release twice');
  assert.equal(presses, 1, 'deferred lostpointercapture must not duplicate short press');
}
{
  const element = new FakeElement(); const eventTarget = new FakeElement(); const timers = createTimers(); let presses = 0;
  element.releasePointerCapture = () => { throw new Error('capture already lost'); };
  bindPressGesture(element, { onPress: () => presses++, setTimer: timers.setTimer, clearTimer: timers.clearTimer, eventTarget });
  element.emit('pointerdown', { pointerId: 30 });
  assert.doesNotThrow(() => element.emit('lostpointercapture', { pointerId: 30 }));
  assert.equal(timers.size, 0);
  element.emit('pointerdown', { pointerId: 31 }); element.emit('pointerup', { pointerId: 31 });
  assert.equal(presses, 1, 'release failure after lost capture must not block the next gesture');
}
{
  const element = new FakeElement(); const eventTarget = new FakeElement(); const timers = createTimers();
  element.releasePointerCapture = () => { throw new Error('injected release failure'); };
  const unbind = bindPressGesture(element, { setTimer: timers.setTimer, clearTimer: timers.clearTimer, eventTarget });
  element.emit('pointerdown', { pointerId: 32 });
  assert.doesNotThrow(() => unbind(), 'pointer capture release failure must not interrupt teardown');
  assert.equal(timers.size, 0);
  assert.equal(eventTarget.listeners.get('blur').size, 0);
  assert.equal(element.listeners.get('pointerdown').size, 0);
}
{
  const element = new FakeElement(); const eventTarget = new FakeElement(); const timers = createTimers();
  const unbind = bindPressGesture(element, { setTimer: timers.setTimer, clearTimer: timers.clearTimer, eventTarget });
  assert.equal(eventTarget.listeners.get('blur').size, 1); unbind();
  assert.equal(eventTarget.listeners.get('blur').size, 0);
  assert.equal(element.listeners.get('pointermove').size, 0);
}
console.log('Press gesture behavior verified.');
