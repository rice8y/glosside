import { readFile, writeFile, mkdir, cp } from 'node:fs/promises';
import path from 'node:path';
import { Marked } from 'marked';

const documents = [
  ['privacy-policy.md', 'Privacy Policy'],
  ['license-notices.md', 'Licenses and Attribution'],
  ['supported-environments.md', 'Supported Environments and Limitations'],
];
const licenses = [
  ['LICENSE', 'LICENSE.txt'],
  ['vendor/plamo-en.txt', 'vendor/licenses/plamo-en.txt'],
  ['vendor/plamo-ja.txt', 'vendor/licenses/plamo-ja.txt'],
  ['vendor/runtime/llama-LICENSE', 'vendor/licenses/llama-cpp.txt'],
  ...[
    'wllama',
    'hash-wasm',
    'hash-wasm-sha256',
    'emscripten',
    'musl',
    'dawn',
    'emdawnwebgpu',
    'llama-components',
    'llvm-runtime',
    'musl-components',
  ].map((name) => [`vendor/licenses/${name}.txt`, `vendor/licenses/${name}.txt`]),
];
const escape = (value) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

export async function buildDocuments(out, icon) {
  // Retained notices must match the packages whose code is actually bundled.
  for (const [retained, source] of [
    ['vendor/licenses/wllama.txt', 'node_modules/@wllama/wllama/LICENCE'],
    ['vendor/licenses/hash-wasm.txt', 'node_modules/hash-wasm/LICENSE'],
  ]) {
    if ((await readFile(retained, 'utf8')) !== (await readFile(source, 'utf8')))
      throw Error(`Review the updated dependency notice: ${retained}`);
  }
  const shaSource = await readFile('node_modules/hash-wasm/src/sha256.c', 'utf8');
  if (
    (await readFile('vendor/licenses/hash-wasm-sha256.txt', 'utf8')).trim() !==
    shaSource.slice(0, shaSource.indexOf(' */') + 3).trim()
  )
    throw Error('Review the updated hash-wasm SHA-256 notice');

  const targets = new Map([
    ...licenses.map(([source, target]) => [path.resolve(source), target]),
    ...documents.map(([name]) => [
      path.resolve('docs', name),
      `docs/${name.replace(/\.md$/, '.html')}`,
    ]),
  ]);
  for (const [source, target] of licenses) {
    await mkdir(path.dirname(path.join(out, target)), { recursive: true });
    await cp(source, path.join(out, target));
  }
  await mkdir(path.join(out, 'docs'), { recursive: true });
  // Only these repository-authored documents are packaged. Remote/user Markdown is never rendered.
  for (const [name, title] of documents) {
    const parser = new Marked({
      renderer: {
        html() {
          throw Error(`Raw HTML is not permitted in public documents: ${name}`);
        },
        image() {
          throw Error(`Images are not permitted in public documents: ${name}`);
        },
        link({ href, title: linkTitle, tokens }) {
          let destination;
          if (href.startsWith('https://')) destination = new URL(href).href;
          else {
            if (/^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith('/') || href.includes('\\'))
              throw Error(`Unsupported document link: ${href}`);
            const target = targets.get(path.resolve('docs', href));
            if (!target) throw Error(`Document link has no packaged destination: ${name}: ${href}`);
            destination = path.posix.relative('docs', target);
          }
          return `<a href="${escape(destination)}" rel="noreferrer"${linkTitle ? ` title="${escape(linkTitle)}"` : ''}>${this.parser.parseInline(tokens)}</a>`;
        },
      },
    });
    const content = parser.parse(await readFile(path.join('docs', name), 'utf8'));
    const nav = documents
      .map(
        ([file, label]) =>
          `<a href="${file.replace(/\.md$/, '.html')}"${file === name ? ' aria-current="page"' : ''}>${escape(label)}</a>`,
      )
      .join('\n');
    await writeFile(
      path.join(out, 'docs', name.replace(/\.md$/, '.html')),
      `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${escape(title)} — Glosside</title>
<link rel="icon" type="image/png" href="../icons/${escape(icon)}">
<link rel="stylesheet" href="../ui/documents.css">
</head>
<body>
<a class="skip-link" href="#content">Skip to content</a>
<header><a class="brand" href="https://github.com/rice8y/glosside" rel="noreferrer">Glosside</a><span>Built with PLaMo.</span></header>
<nav aria-label="Documentation">${nav}</nav>
<main id="content"><article>${content}</article></main>
<footer>Published by Eito Yoneyama.</footer>
</body>
</html>\n`,
    );
  }
}
