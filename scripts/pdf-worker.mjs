import { readFile } from 'node:fs/promises';

// PDF.js already parses the embedded Type1/CFF charset. Export that evidence
// alongside fontExtraProperties instead of guessing aliases from font names.
// The pinned dependency and exact insertion checks make upstream ABI changes
// fail the build rather than silently disabling the additional metadata.
export async function pdfWorkerSource() {
  let source = await readFile('node_modules/pdfjs-dist/build/pdf.worker.mjs', 'utf8');
  const replace = (from, to) => {
    if (source.split(from).length !== 2)
      throw Error('PDF.js embedded glyph metadata patch requires review');
    source = source.replace(from, to);
  };
  replace(
    'const EXPORT_DATA_EXTRA_PROPERTIES = [',
    'const EXPORT_DATA_EXTRA_PROPERTIES = ["embeddedGlyphs", ',
  );
  replace(
    '    const mapping = font.getGlyphMapping(properties);',
    `    const mapping = font.getGlyphMapping(properties);
    if (this.fontExtraProperties && mapping.size <= 65536) {
      const charset = font.getCharset();
      const glyphUnicode = getGlyphsUnicode();
      this.embeddedGlyphs = [...mapping].flatMap(([code, gid]) => {
        const name = charset[gid];
        if (typeof name !== "string") return [];
        const value = getUnicodeForGlyph(name, glyphUnicode);
        return [{ code, name, ...(value >= 0 && value <= 0x10ffff ? { unicode: String.fromCodePoint(value) } : {}) }];
      });
    }`,
  );
  return (
    '/*! Modified by Glosside: export embedded Type1/CFF glyph metadata; see scripts/pdf-worker.mjs. */\n' +
    source
  );
}
