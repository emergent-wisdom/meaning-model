// Optional authored document spans use the native projection's byte coordinate, not prose-word or world time.
export function appendDocumentSpans(container, projection) {
  if (!Array.isArray(projection?.spans) || !projection.spans.length) return false;
  const document = container.ownerDocument;
  const element = (tag, className, text) => {
    const node = document.createElement(tag); node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const number = (value) => value.toLocaleString('en-GB');
  const endpoint = (ref) => ref?.kind === 'node' ? `node:${ref.node_id}`
    : ref?.kind === 'anchor' ? `${ref.anchor_kind}:${ref.anchor_id}` : 'unknown endpoint';
  const disclosure = element('details', 'document-spans');
  disclosure.append(element('summary', '', `Document spans (${projection.spans.length})`));
  const body = element('div', 'document-spans-body');
  body.append(element('p', 'document-span-help', 'Authored span boundaries in this document, not world time. Bands use a separate UTF-8 byte axis; no process values or reader responses are inferred.'));
  const validCoordinate = projection.coordinate === 'utf8_byte' && projection.interval === 'half_open'
    && Number.isSafeInteger(projection.byteLength) && projection.byteLength >= 0;
  for (const span of projection.spans) {
    const row = element('div', 'document-span-row');
    row.append(element('div', 'document-span-title', span.title || span.nodeId));
    row.append(element('div', 'document-span-ref', `Span node: ${span.nodeId}`));
    const resolved = validCoordinate && span.status === 'resolved' && Number.isSafeInteger(span.start)
      && Number.isSafeInteger(span.end) && span.start >= 0 && span.end >= span.start && span.end <= projection.byteLength;
    if (resolved) {
      row.append(element('div', 'document-span-range', `UTF-8 bytes [${number(span.start)}, ${number(span.end)}) of ${number(projection.byteLength)}`));
      const axis = element('div', 'document-span-axis');
      const band = element('div', `document-span-band${span.start === span.end ? ' point' : ''}`);
      band.style.left = `${projection.byteLength ? span.start / projection.byteLength * 100 : 0}%`;
      band.style.width = `${projection.byteLength ? (span.end - span.start) / projection.byteLength * 100 : 0}%`;
      axis.append(band); row.append(axis);
    } else {
      const reason = span.status !== 'resolved' ? span.reason || span.status || 'unresolved'
        : !validCoordinate ? 'unsupported_document_coordinate' : 'invalid_byte_range';
      row.append(element('div', 'document-span-status', `Unresolved: ${reason}`));
    }
    for (const link of span.links ?? []) {
      row.append(element('div', 'document-span-link', `${link.family ?? ''} / ${link.relation ?? ''}: ${endpoint(link.source)} → ${endpoint(link.target)}`));
    }
    body.append(row);
  }
  disclosure.append(body); container.append(disclosure); return true;
}
