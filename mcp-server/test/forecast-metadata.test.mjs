import assert from 'node:assert/strict';
import test from 'node:test';
import { forecastMetadata } from '../src/forecast-metadata.mjs';

const cut = (declaration, cutoff = '2025', horizon = '2030') => ({
  question: 'Will an outbreak start before the horizon?', unit: 'one unit of belief',
  answers: [{ key: 'yes', weight: 0.3 }, { key: 'no', weight: 0.7 }],
  provenance: [declaration, `evidence cutoff: ${cutoff}`, `horizon: ${horizon}`, 'settled by: the town register'],
});
const declared = 'forecast: these weights are probabilities';

test('ordinary punctuation does not turn an explicit probability denial into a bound forecast', () => {
  for (const declaration of [
    "forecast: these weights aren't probabilities", 'forecast: these weights aren’t probabilities',
    'forecast: these weights arenʼt probabilities', 'forecast: probabilities aren’t declared',
    'forecast: probabilities are not yet declared', 'forecast: probabilities unknown',
    'forecast: probabilities are not actually probabilities', 'forecast: probabilities aren’t being declared',
    'forecast: probabilities are not actually being declared',
    'forecast: non‑probabilistic likelihood weights', 'forecast: shares rather than probabilities',
  ]) {
    const metadata = forecastMetadata(cut(declaration));
    assert.equal(metadata.declared, false, declaration);
    assert.equal(metadata.binding, null, declaration);
  }
});

test('uncertain settlement and negated outcomes do not deny declared probabilities', () => {
  for (const declaration of [
    'forecast: probabilities are not yet settled', 'forecast: probabilities aren’t yet settled',
    'forecast: probabilities have not yet been settled', 'forecast: probabilities are not yet calibrated',
    'forecast: probability of no outbreak, guessed before the outcome',
    'forecast: chance of no sale, not yet settled',
  ]) {
    const metadata = forecastMetadata(cut(declaration));
    assert.equal(metadata.declared, true, declaration);
    assert.deepEqual(metadata.binding?.window, { start: 2025, end: 2030 }, declaration);
  }
});

test('forecast times preserve signed decimals, scientific notation and supported annotations', () => {
  for (const [cutoff, horizon, expected] of [
    ['2.025e3', '2.030e3', [2025, 2030]],
    ['-.5', '.5', [-0.5, 0.5]],
    ['-5e-1', '+5E-1', [-0.5, 0.5]],
    ['hour 7', 'hour 24', [7, 24]],
    ['2025.9 (October 2025)', '2030 (January 2030)', [2025.9, 2030]],
    ['-0.5 hours', '+.5 hours', [-0.5, 0.5]],
    ['−.5', '.5', [-0.5, 0.5]],
    ['−5', '5', [-5, 5]],
    ['hour −5', 'hour −.5', [-5, -0.5]],
  ]) {
    const metadata = forecastMetadata(cut(declared, cutoff, horizon));
    assert.equal(metadata.binding?.cutoff, expected[0], cutoff);
    assert.deepEqual(metadata.binding?.window, { start: expected[0], end: expected[1] }, horizon);
  }
});

test('malformed, ambiguous and non-finite times do not acquire a different numeric binding', () => {
  for (const time of ['2.025e', '-.5e+', '2.0.25', '2025-2026', '2025 or 2026', 'hour 7 or 8', 'year2025', '1e309']) {
    for (const [cutoff, horizon] of [[time, '2030'], ['-10000', time]]) {
      const metadata = forecastMetadata(cut(declared, cutoff, horizon));
      assert.equal(metadata.declared, true);
      assert.equal(metadata.binding, null, time);
      assert.match(metadata.problem, /does not state its own evidence cutoff and horizon/);
    }
  }
});
