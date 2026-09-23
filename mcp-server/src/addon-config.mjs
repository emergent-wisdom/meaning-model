export const availableAddons = Object.freeze(['storytelling', 'alien']);

export function parseEnabledAddons(value = '') {
  if (typeof value !== 'string') {
    throw new Error('MEANING_MODEL_ADDONS must be a comma-separated string.');
  }
  const addons = [...new Set(value.split(',').map((name) => name.trim()).filter(Boolean))];
  for (const name of addons) {
    if (!availableAddons.includes(name)) {
      throw new Error(
        `Unknown Meaning Model addon ${JSON.stringify(name)} in MEANING_MODEL_ADDONS. ` +
        `Available addons: ${availableAddons.join(', ')}.`,
      );
    }
  }
  return addons;
}
