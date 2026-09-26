const assert = require('node:assert/strict');

function assertCjkRasterEvidence(evidence) {
  assert(evidence?.glyphs?.length >= 8, 'CJK raster probe did not run');
  assert(evidence.missingSignatures?.length >= 2 && evidence.missingSignatures.every(value => typeof value === 'string' && value.length),
    'CJK raster probe requires missing-glyph reference signatures');
  const missing = new Set(evidence.missingSignatures);
  assert(evidence.glyphs.every(glyph => Number.isFinite(glyph.inkPixels) && glyph.inkPixels > 0
    && typeof glyph.signature === 'string' && glyph.signature.length && !missing.has(glyph.signature)),
    'CJK glyphs are blank or rendered as missing-glyph boxes');
  assert.equal(new Set(evidence.glyphs.map(glyph => glyph.signature)).size, evidence.glyphs.length,
    'Distinct Chinese characters rendered as identical glyphs');
  return evidence;
}

async function verifyRenderedCjk(page, selector) {
  const evidence = await page.locator(selector).evaluate(async element => {
    await document.fonts.ready;
    const style = getComputedStyle(element);
    const canvas = document.createElement('canvas');
    canvas.width = 80; canvas.height = 80;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('CJK raster probe requires Canvas 2D');
    context.font = `${style.fontWeight} 40px ${style.fontFamily}`;
    context.textBaseline = 'top';
    function raster(character) {
      context.clearRect(0, 0, 80, 80);
      context.fillText(character, 8, 8);
      const pixels = context.getImageData(0, 0, 80, 80).data;
      let hash = 2166136261; let inkPixels = 0;
      for (let index = 3; index < pixels.length; index += 4) {
        const alpha = pixels[index];
        hash = Math.imul(hash ^ alpha, 16777619) >>> 0;
        if (alpha) inkPixels++;
      }
      return { character, signature: hash.toString(16), inkPixels };
    }
    return { fontFamily: style.fontFamily, fontWeight: style.fontWeight,
      missingSignatures: ['\u0378', '\u{10ffff}'].map(character => raster(character).signature),
      glyphs: Array.from('采购版本变更数量审批').map(raster) };
  });
  try { return assertCjkRasterEvidence(evidence); }
  catch (error) { error.fontEvidence = evidence; throw error; }
}

module.exports = { verifyRenderedCjk, assertCjkRasterEvidence };
