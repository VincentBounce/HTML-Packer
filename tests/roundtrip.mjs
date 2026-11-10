// Round-trip test: each example is compacted by index.html (the tool) itself (deflate, Roadroller, and the UI's pick),
// then the original and each compacted page are rendered; their normalized DOM and screenshots must match.
// Usage: node tests/roundtrip.mjs   (needs `playwright` resolvable, e.g. NODE_PATH)
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const { chromium } = createRequire(import.meta.url)('playwright'); // CJS require honours NODE_PATH
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tool = pathToFileURL(path.join(root, 'index.html')).href;
const examples = ['simple.html', 'canvas.html', 'styled.html'];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'compact-'));
const bytes = s => Buffer.byteLength(s);

// Structure of the rendered page, insensitive to what minification legitimately changes
// (whitespace-only text, comments, attribute quoting/order, class order, script/style source,
// boolean attribute values, and attributes equal to their default, which removeRedundantAttributes drops)
function snapshot() {
  const defaults = { 'form method': 'get', 'input type': 'text', 'button type': 'submit', 'script type': 'text/javascript',
                     'style type': 'text/css', 'link type': 'text/css', 'script language': 'javascript', 'a name': null };
  // boolean attributes mean their presence only (collapseBooleanAttributes turns checked=checked into checked)
  const booleans = new Set('allowfullscreen async autofocus autoplay checked controls default defer disabled formnovalidate hidden inert ismap loop multiple muted nomodule novalidate open playsinline readonly required reversed selected'.split(' '));
  const isDefault = (tag, a) => defaults[tag + ' ' + a.name] === a.value.toLowerCase();
  const walk = n => {
    if (n.nodeType === 3) { const t = n.data.replace(/\s+/g, ' ').trim(); return t ? JSON.stringify(t) : null; }
    if (n.nodeType !== 1) return null;
    const tag = n.tagName.toLowerCase();
    const attrs = [...n.attributes].filter(a => !isDefault(tag, a)).map(a => {
      let v = a.value;
      if (booleans.has(a.name)) v = '';
      if (a.name === 'class') v = v.split(/\s+/).filter(Boolean).sort().join(' ');
      if (a.name === 'style') v = n.style.cssText;
      return a.name + '=' + v;
    }).sort();
    const kids = tag === 'script' || tag === 'style' ? [] : [...n.childNodes].map(walk).filter(Boolean);
    return '<' + tag + (attrs.length ? ' ' + attrs.join(' ') : '') + '>' + kids.join('') + '</' + tag + '>';
  };
  return document.compatMode + ' ' + document.title + ' ' + walk(document.documentElement);
}

async function render(page, url, title) {
  // the deflate loader never calls document.close(), so "load" may never come: wait for the written title
  await page.goto(url, { waitUntil: 'commit' });
  await page.waitForFunction(t => document.title === t && document.body, title, { timeout: 15000 });
  await page.waitForTimeout(300);
  return { dom: await page.evaluate(snapshot), png: await page.screenshot() };
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 800, height: 600 } });
const toolPage = await ctx.newPage();
const errors = [];
toolPage.on('pageerror', e => errors.push('tool: ' + e.message));
await toolPage.goto(tool);
await toolPage.waitForFunction(() => window.HTMLMinifier);

let failed = 0;
const rows = [];
for (const name of examples) {
  const src = fs.readFileSync(path.join(root, 'examples', name), 'utf8');
  const title = src.match(/<title>(.*?)<\/title>/)[1];
  // 1) the packers, called directly in the tool page (file://, so Roadroller's Blob worker runs from file:// too)
  const out = await toolPage.evaluate(async src => {
    const min = await HTMLMinifier.minify(src, minifyOptions(false));
    const deflate = await packDeflate(min);
    const roadroller = await packRoadroller(min, () => {});
    stopWorker();
    return { min, deflate, roadroller };
  }, src);
  // 2) the UI itself: paste, both modes on, wait for Roadroller, read the kept HTML and the URI
  await toolPage.evaluate(src => { $('optRoad').checked = true; $('optDeflate').checked = true; $('src').value = src; }, src);
  await toolPage.click('#run');
  await toolPage.waitForFunction(() => /Roadroller: [\d.]+ s|error/.test($('status').textContent), null, { timeout: 120000 });
  const ui = await toolPage.evaluate(() => ({ html: $('outHtml').value, uri: $('outUri').value, status: $('status').textContent }));

  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(name + ': ' + e.message));
  const file = (tag, html) => { const f = path.join(tmp, name.replace('.html', '') + '.' + tag + '.html'); fs.writeFileSync(f, html); return pathToFileURL(f).href; };
  const ref = await render(page, pathToFileURL(path.join(root, 'examples', name)).href, title);
  const variants = {
    minified: file('min', out.min), deflate: file('deflate', out.deflate), roadroller: file('roadroller', out.roadroller),
    'ui html': file('ui', ui.html), 'ui data: URI': ui.uri,
  };
  for (const [tag, url] of Object.entries(variants)) {
    const got = await render(page, url, title);
    const domOk = got.dom === ref.dom, pngOk = got.png.equals(ref.png);
    if (!domOk || !pngOk) {
      failed++;
      console.log(`FAIL ${name} [${tag}] dom:${domOk} pixels:${pngOk}`);
      if (!domOk) {
        let i = 0; while (ref.dom[i] === got.dom[i]) i++;
        console.log('  ref: …' + ref.dom.slice(Math.max(0, i - 80), i + 120) + '\n  got: …' + got.dom.slice(Math.max(0, i - 80), i + 120));
      }
    } else console.log(`ok   ${name} [${tag}]`);
  }
  await page.close();
  rows.push({ name, raw: bytes(src), min: bytes(out.min), deflate: bytes(out.deflate), roadroller: bytes(out.roadroller),
              kept: ui.status.replace(/.*Kept: /, ''), html: bytes(ui.html), uri: bytes(ui.uri) });
}
await browser.close();
console.table(rows);
if (errors.length) { console.log('page errors:\n' + errors.join('\n')); failed++; }
console.log(failed ? `${failed} FAILURE(S)` : 'ALL PASS');
process.exit(failed ? 1 : 0);
