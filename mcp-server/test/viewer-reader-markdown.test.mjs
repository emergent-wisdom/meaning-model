import test from 'node:test';
import assert from 'node:assert/strict';
import { readerInline } from '../viewer/public/reader-markdown.js';

test('soft source wrapping reflows while explicitly lineated text retains its breaks', () => {
  assert.equal(readerInline('She opened the\nregister.'), 'She opened the register.');
  assert.equal(readerInline('water  \nstone\\\nlight'), 'water<br>stone<br>light');
  assert.equal(readerInline('First\r\nsecond'), 'First second');
  assert.equal(readerInline('**Wait**  \n<img src=x> & "listen"'), '<strong>Wait</strong><br>&lt;img src=x&gt; &amp; &quot;listen&quot;');
});
