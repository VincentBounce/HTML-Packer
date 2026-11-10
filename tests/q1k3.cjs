// Folder test: examples/q1k3 (fetches its data files l and m) packed through the folder input must run from file://
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const outDir = require('fs').mkdtempSync(require('os').tmpdir() + '/q1k3-');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 800, height: 500 } });
  const tool = await ctx.newPage();
  tool.on('pageerror', e => console.log('tool error', e.message));
  await tool.goto('file://' + encodeURI(root + '/index.html'));
  await tool.setInputFiles('#dir', root + '/examples/q1k3');
  await tool.waitForFunction(() => /Kept/.test(document.getElementById('status').textContent), null, { timeout: 60000 });
  console.log(await tool.evaluate(() => $('files').textContent + '\n' + [...$('sizes').rows].map(r => r.innerText.replace(/\t/g, ' | ')).join('\n')));
  const out = await tool.evaluate(() => $('outHtml').value);
  const f = outDir + '/q1k3.packed.html'; fs.writeFileSync(f, out);
  for (const [tag, url] of [['original file://', 'file://' + encodeURI(root + '/examples/q1k3/index.html')], ['packed file://', 'file://' + f]]) {
    const p = await ctx.newPage(); const errs = [];
    p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && errs.push(m.text()));
    await p.goto(url, { waitUntil: 'commit' }); await p.waitForTimeout(4000);
    await p.screenshot({ path: outDir + '/' + tag.split(' ')[0] + '.png' });
    const canvas = await p.evaluate(() => { const c = document.querySelector('canvas'); return c ? c.width + 'x' + c.height : 'none'; });
    console.log(tag, '| canvas', canvas, '| errors:', errs.slice(0, 3).join(' ;; ') || 'none');
    await p.close();
  }
  await b.close();
})();
