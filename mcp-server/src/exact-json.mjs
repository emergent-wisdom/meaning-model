// JSON.stringify normally turns -0 into 0. The Rust engine hashes their distinct JSON encodings, so every boundary
// that carries a model must keep its sign. JSON.rawJSON is available in the supported Node.js versions (>=22.18).
export function stringifyJson(value, replacer = null, space = undefined) {
  return JSON.stringify(value, function (key, item) {
    const replaced = typeof replacer === 'function' ? replacer.call(this, key, item) : item;
    return Object.is(replaced, -0) ? JSON.rawJSON('-0.0') : replaced;
  }, space);
}

// The MCP SDK owns the final JSON.stringify of structuredContent. Copy only paths with a negative zero and give
// that serializer a raw numeric token. Clients receive an ordinary JSON number, with no new fields or schema.
export function jsonWireValue(value) {
  if (Object.is(value, -0)) return JSON.rawJSON('-0.0');
  if (value === null || typeof value !== 'object') return value;
  let result = value;
  for (const key of Object.keys(value)) {
    const item = jsonWireValue(value[key]);
    if (item === value[key]) continue;
    if (result === value) result = Array.isArray(value) ? value.slice() : { ...value };
    Object.defineProperty(result, key, { value: item, enumerable: true, writable: true, configurable: true });
  }
  return result;
}
