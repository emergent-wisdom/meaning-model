import { loadData } from './common.js';
import { showInspector } from './inspector.js';

try {
  const { data } = await loadData(new URLSearchParams(location.search));
  if (data.viewKind === 'inspector') showInspector(data);
  else {
    try { await import('./view.js'); }
    catch (error) { showInspector(data, 'The 3D view is unavailable in this browser. The recorded model is available below.'); console.error(error); }
  }
} catch (error) {
  showInspector(null, `The model snapshot could not be opened: ${error.message}`);
}
