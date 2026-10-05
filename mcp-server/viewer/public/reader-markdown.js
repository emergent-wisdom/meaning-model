// Markdown source wrapping is not a prose line break. Preserve explicit hard
// breaks (two spaces or a backslash), including intentional verse lineation.
export function readerInline(text) {
  const escape = (value) => value.replace(/[&<>"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character]);
  return String(text).replace(/\r\n/g, '\n').split(/( {2,}\n|\\\n|\n)/).map((part) => {
    if (part === '\n') return ' ';
    if (/^(?: {2,}|\\)\n$/.test(part)) return '<br>';
    return escape(part).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>')
      // _word_ emphasis, as Markdown and plain-text editions write italics; never inside a word like snake_case.
      .replace(/(^|[\s(\[“‘"'—-])_([^_\s](?:[^_]*[^_\s])?)_(?=$|[\s.,;:!?)\]”’"'—-])/gu, '$1<em>$2</em>');
  }).join('');
}
