// Pulls a marked block of app code out of index.html so it can be unit-tested.
//
// The app is one 5,900-line index.html with every function inside a single
// IIFE — there is no module to import. Rather than restructure the file (and
// risk the thing that is actually shipping), the functions worth testing are
// wrapped in sentinels:
//
//     /* @export:name */  … code …  /* @end */
//
// and this reads them back out. If a sentinel is ever removed the test fails
// loudly rather than silently passing on nothing.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export function extract(name) {
  const src = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const open = `/* @export:${name} */`;
  const i = src.indexOf(open);
  if (i < 0) throw new Error(`sentinel /* @export:${name} */ not found in index.html`);
  const j = src.indexOf('/* @end */', i);
  if (j < 0) throw new Error(`no /* @end */ after /* @export:${name} */`);
  return src.slice(i + open.length, j);
}

/** Evaluate one or more extracted blocks together and return the named globals. */
export function build(names, wants, prelude = '') {
  const code = names.map(extract).join('\n');
  const fn = new Function(`${prelude}\n${code}\nreturn {${wants.join(',')}};`);
  return fn();
}

export function fixture(name) {
  return readFileSync(join(ROOT, 'test', 'fixtures', name), 'utf8');
}
