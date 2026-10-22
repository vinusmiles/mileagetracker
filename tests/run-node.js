// Run with:  node tests/run-node.js   (or: npm test)
import './calc.test.js';
import { runAll } from './harness.js';

const results = await runAll();
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.pass ? '' : `\n      ${r.error}`}`);
const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
