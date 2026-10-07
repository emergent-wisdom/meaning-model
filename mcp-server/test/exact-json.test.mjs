import assert from 'node:assert/strict';
import test from 'node:test';
import { jsonWireValue, stringifyJson } from '../src/exact-json.mjs';

test('JSON boundaries preserve negative zero in nested objects and arrays without changing ordinary JSON', () => {
  const value = JSON.parse('{"__proto__":{"number":-0.0},"values":[-0.0,0,1.25,null]}');
  const encoded = stringifyJson(value);
  assert.equal(encoded, '{"__proto__":{"number":-0.0},"values":[-0.0,0,1.25,null]}');
  assert.deepEqual(JSON.parse(encoded), value);
  assert.deepEqual(JSON.parse(JSON.stringify(jsonWireValue(value))), value);
  assert.ok(Object.is(value.values[0], -0), 'the source remains a normal number');
  const ordinary = { a: [0, 1.25, null], text: 'Å😀\n"quoted"' };
  assert.equal(stringifyJson(ordinary), JSON.stringify(ordinary));
  assert.equal(jsonWireValue(ordinary), ordinary, 'ordinary values need no copy');
});
