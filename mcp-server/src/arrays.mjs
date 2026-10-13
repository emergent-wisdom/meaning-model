// Lists as long as a model allows: millions of dated values, Events or records. Spreading such a list into a call's
// arguments (Math.min(...values), list.push(...more)) overflows the stack somewhere past a hundred thousand items, so
// these walk it instead.

// The smallest and largest of a list of numbers, or null for an empty list.
export function extent(values) {
  let min = Infinity, max = -Infinity, any = false;
  for (const value of values) {
    any = true;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return any ? [min, max] : null;
}

export const minOf = (values) => extent(values)?.[0] ?? Infinity;
export const maxOf = (values) => extent(values)?.[1] ?? -Infinity;

// Append every item of a list to another.
export function pushAll(target, items) {
  for (const item of items) target.push(item);
  return target;
}
