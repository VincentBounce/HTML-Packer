# HTML Packer

Turns an HTML page, or a whole folder, into one file as small as possible: a `.html` file and a `data:` URI.

**[Open HTML Packer](https://vincentbounce.github.io/HTML-Packer/)**: one page, nothing to install. It also runs from a double-click: save `index.html` and open it (the libraries load from jsDelivr, so it needs internet).

## What it does

1. **Inline** (when a folder or several files are given): `<script src>` and stylesheets go inside the page, images, audio, video and icons become `data:` URIs, and every other file is served to `fetch()` from inside the page (in deflate mode as raw bytes in a deflate stream of their own, not as base64). A page that only runs from a local server (because it fetches its data files) then runs with a double-click from `file://`.
2. **Minify** with [html-minifier-terser](https://github.com/terser/html-minifier-terser): whitespace, comments, attribute quotes, boolean attributes; CSS with [csso](https://github.com/css/csso) (html-minifier's own clean-css breaks `:nth-child(1 of S)`); JS with Terser (compress + mangle, never property mangling). **Aggressive** adds top-level mangling, `passes: 3`, `unsafe`, and the removal of default attributes (`type=text`…), which breaks CSS or JS that selects on them (`input[type=text]`).
3. **Pack**, and keep the smallest of:
   - **minified only** (best on tiny pages, where any loader costs more than it saves);
   - **deflate** (default): `CompressionStream("deflate-raw")` + base64, inflated by a one-line loader:
     ```html
     <script>(async()=>document.write(await new Response((await fetch("data:;base64,…")).body.pipeThrough(new DecompressionStream("deflate-raw"))).text()))()</script>
     ```
   - **[Roadroller](https://github.com/lifthrasiir/roadroller)** (optional, slower, runs in a Web Worker).

Outputs: the final HTML (copy, download), the `data:` URI (copy; only `%`, `#` and line breaks are percent-encoded) and its QR code when it fits (up to 2,953 bytes; PNG download); a note says how much is too many for a QR code, or for an address bar (Chrome opens URLs of 2 MiB at most: 2,097,152 characters), the sizes in bytes with their ratio, and a preview in a sandboxed iframe.

## Input

- Paste HTML into the input box, or
- drop an `.html` file, several files, or a folder on it, or use **Open files…** / **Open folder…**.

With several files, the page is the shallowest `.html` (`index.html` first). The files it links to (scripts, stylesheets, images) always go inside. Every other file is listed with a box, one per file in the page's folder and one per subfolder: ticked, it is served to `fetch()` from inside the page. The page's folder starts ticked, except licence, readme, changelog and Markdown files; subfolders start unticked (tools, older versions, other pages). A file is read only when it goes in, and hidden folders (`.git`…) are not even walked: a whole project folder such as [Tessera](https://github.com/VincentBounce/Tessera) packs in a few seconds into its page alone (3.1 MB → 613 KB).

## Examples

| Example | Raw | Kept | Final HTML |
|---|---:|---|---:|
| [simple.html](examples/simple.html) | 974 B | minified only | 730 B |
| [canvas.html](examples/canvas.html) | 6,251 B | deflate | 2,024 B |
| [styled.html](examples/styled.html) | 1,522 B | deflate | 984 B |
| [q1k3/](examples/q1k3) (folder: `index.html`, `l`, `m`) | 18,240 B | deflate | 18,591 B |

[Q1K3](https://github.com/phoboslab/q1k3) is Dominic Szablewski's Quake demake for js13kGames 2021 (MIT, see [its license](examples/q1k3/LICENSE.md)). Its page fetches its maps (`l`) and models (`m`), so it needs a server; [q1k3-packed.html](examples/q1k3-packed.html) is the same game in one file that runs from `file://`. It is about the size of the three files together: the game is already Roadroller-packed, and a page has to carry its compressed bytes as base64 (+33 %), where js13kGames measures a binary ZIP (13.3 KB).

## Limits

- Only `fetch()` is served from the page, not `XMLHttpRequest`.
- `url()` references inside CSS are not inlined.
- The deflate loader never calls `document.close()`, so the packed page gets no `load` event: a script waiting for `window.onload` will not start.

## Tests

[Playwright](https://playwright.dev) round trips (`npm i playwright && npx playwright install chromium`):

```bash
node tests/roundtrip.mjs
```

Each example is packed by the tool itself (minified, deflate, Roadroller, the UI's pick and its `data:` URI); every result must render the same normalized DOM and the same pixels as the original.

```bash
node tests/q1k3.cjs
```

The Q1K3 folder, packed through **Open folder…**, must run from `file://` with no error (the original fails on `fetch`).

## License

[MIT](LICENSE)
