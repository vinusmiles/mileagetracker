// A tiny test harness that runs both in Node (tests/run-node.js) and in a
// browser (tests/index.html), so no test framework needs to be installed.

const registered = [];

export function test(name, fn) {
  registered.push({ name, fn });
}

export const assert = {
  equal(actual, expected, msg = '') {
    if (actual !== expected) throw new Error(`${msg} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  },
  close(actual, expected, tolerance = 0.01, msg = '') {
    if (typeof actual !== 'number' || Math.abs(actual - expected) > tolerance) {
      throw new Error(`${msg} expected ≈${expected}, got ${JSON.stringify(actual)}`);
    }
  },
  ok(value, msg = 'expected a truthy value') {
    if (!value) throw new Error(msg);
  },
};

export async function runAll() {
  const results = [];
  for (const t of registered) {
    try {
      await t.fn();
      results.push({ name: t.name, pass: true });
    } catch (err) {
      results.push({ name: t.name, pass: false, error: err.message });
    }
  }
  return results;
}
