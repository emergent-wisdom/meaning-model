// Portable history contains complete administrative model definitions, not a
// projected view. Match the viewer's complete-author-view rule for every model
// revision before putting it into an export, including unanchored private data.
export function requireCompleteModelScopes(model, accessScopes) {
  const allowed = new Set(accessScopes);
  const pending = [model];
  while (pending.length) {
    const value = pending.pop();
    if (!value || typeof value !== 'object') continue;
    if (Array.isArray(value)) { for (const item of value) pending.push(item); continue; }
    for (const [key, item] of Object.entries(value)) {
      if (key === 'access_scopes' && Array.isArray(item)) {
        if (item.some((scope) => !allowed.has(scope))) {
          throw new Error('The complete construction export requires access to every scoped model record. The supplied accessScopes are insufficient.');
        }
      } else if (item && typeof item === 'object') pending.push(item);
    }
  }
}
