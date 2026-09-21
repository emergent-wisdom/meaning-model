// Optional external estimator ("Jev on/off"). Off unless MEANING_MODEL_ESTIMATOR names a backend.
// When on, the two estimator tools send the supplied text to that service; nothing else does.
export const availableEstimators = Object.freeze(['typesafe']);
const DEFAULT_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
const DEFAULT_MODEL = 'jev-latest';
export const MAX_ESTIMATOR_REQUEST_CHARS = 120_000;

export function parseEstimatorConfig(env = {}) {
  const raw = typeof env.MEANING_MODEL_ESTIMATOR === 'string' ? env.MEANING_MODEL_ESTIMATOR.trim() : '';
  if (!raw) return { backend: null };
  if (!availableEstimators.includes(raw)) {
    throw new Error(`Unknown Meaning Model estimator ${JSON.stringify(raw)} in MEANING_MODEL_ESTIMATOR. Available estimators: ${availableEstimators.join(', ')}.`);
  }
  const apiKey = typeof env.TYPESAFE_API_KEY === 'string' ? env.TYPESAFE_API_KEY.trim() : '';
  if (!apiKey) throw new Error('MEANING_MODEL_ESTIMATOR=typesafe requires TYPESAFE_API_KEY in the server environment.');
  const model = (typeof env.TYPESAFE_MODEL === 'string' && env.TYPESAFE_MODEL.trim()) || DEFAULT_MODEL;
  const endpoint = (typeof env.TYPESAFE_ENDPOINT === 'string' && env.TYPESAFE_ENDPOINT.trim()) || DEFAULT_ENDPOINT;
  if (!/^https:\/\//.test(endpoint)) throw new Error('TYPESAFE_ENDPOINT must be an https URL.');
  return { backend: 'typesafe', model, endpoint, apiKey };
}

export function createEstimator(config, { fetch: fetchImpl = globalThis.fetch } = {}) {
  if (!config || config.backend === null) return null;
  if (config.backend !== 'typesafe') throw new Error(`Unsupported estimator backend ${config.backend}.`);
  if (typeof fetchImpl !== 'function') throw new Error('An estimator requires a fetch implementation.');
  const { model, endpoint, apiKey } = config;
  return Object.freeze({
    backend: 'typesafe',
    model,
    label: `typesafe:${model}`,
    async estimate(state, questions) {
      const body = JSON.stringify({ model, state, questions });
      if (body.length > MAX_ESTIMATOR_REQUEST_CHARS) {
        throw new Error(`Estimator request is ${body.length} characters; the limit is ${MAX_ESTIMATOR_REQUEST_CHARS}. Select fewer records or a smaller unit.`);
      }
      const response = await fetchImpl(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body });
      let json = null;
      try { json = await response.json(); } catch { json = null; }
      if (!response.ok) {
        const detail = json && typeof json === 'object' ? JSON.stringify(json).slice(0, 300) : '';
        throw new Error(`Estimator request failed with HTTP ${response.status}. ${detail}`.trim());
      }
      if (!json || typeof json !== 'object' || !json.answers || typeof json.answers !== 'object') {
        throw new Error('Estimator response did not contain answers.');
      }
      return { answers: json.answers, usage: json.usage ?? null, model: typeof json.model === 'string' ? json.model : model };
    },
  });
}
