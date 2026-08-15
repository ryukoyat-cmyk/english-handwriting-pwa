/* Regression harness for the PRD acceptance criteria.
   Usage:  python3 -m http.server 8777   &&   node verify.js            */
const { chromium } = require('/tmp/claude-0/-home-user-english-handwriting-pwa/0df8d567-3948-5fe3-ada1-0ac75c562fe4/scratchpad/node_modules/playwright');

const URL = 'http://localhost:8777/index.html';
const EXE = '/opt/pw-browsers/chromium';
const results = [];
const ok   = (n, d) => results.push({ n, pass: true,  d });
const bad  = (n, d) => results.push({ n, pass: false, d });
const near = (a, b, tol) => Math.abs(a - b) <= tol;

async function fresh(browser, vw, vh) {
  // a fresh context already starts with empty localStorage — do NOT use
  // addInitScript to clear it, that would also wipe state on reload()
  const ctx = await browser.newContext({ viewport: { width: vw, height: vh } });
  const page = await ctx.newPage();
  await page.goto(URL);
  await page.waitForFunction(() => window.__app && window.__app.fm, null, { timeout: 8000 });
  await page.waitForTimeout(350);
  return { ctx, page };
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXE });

  /* ---------- F-1 layout at three widths ---------- */
  for (const [w, h] of [[390, 844], [768, 1024], [1920, 1080]]) {
    const { ctx, page } = await fresh(browser, w, h);
    const b = await page.evaluate(() => {
      const box = s => { const e = document.querySelector(s); const r = e.getBoundingClientRect(); return { w: +r.width.toFixed(1), h: +r.height.toFixed(1) }; };
      return { stage: box('.stage'), sheet: box('.sheet'), guide: box('.guide'),
               overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
               sidebar: !!document.querySelector('.sidebar') };
    });
    const good = b.stage.w > 0 && b.sheet.w > w * 0.5 && b.guide.w > w * 0.4 && b.overflow <= 0 && !b.sidebar;
    (good ? ok : bad)(`F-1 layout @${w}px`, `sheet ${b.sheet.w} · guide ${b.guide.w} · overflow ${b.overflow}`);
    await ctx.close();
  }

  /* ---------- F-2 four-rule alignment ---------- */
  {
    const { ctx, page } = await fresh(browser, 1440, 900);
    const m = await page.evaluate(() => {
      const g = document.querySelector('.guide');
      g.textContent = 'Hbdlxy';
      g.dispatchEvent(new Event('input'));
      const geo = window.__app.geo, fm = window.__app.fm;

      // resolve the four rule positions straight out of the computed background
      const pos = getComputedStyle(g).backgroundPosition
        .split(',').map(s => parseFloat(s.trim().split(/\s+/)[1]));
      const L1 = pos[0], L2 = pos[1], L3 = pos[2], L4 = pos[3];

      // ink extents of the rendered text, measured against the element's top
      const cvs = document.createElement('canvas').getContext('2d');
      const cs = getComputedStyle(g);
      cvs.font = `${cs.fontWeight} ${parseFloat(cs.fontSize)}px ${cs.fontFamily}`;
      const capAsc = cvs.measureText('H').actualBoundingBoxAscent;
      const ascAsc = cvs.measureText('bdfhklt').actualBoundingBoxAscent;
      const xAsc   = cvs.measureText('x').actualBoundingBoxAscent;
      const yDesc  = cvs.measureText('y').actualBoundingBoxDescent;
      const band   = parseFloat(getComputedStyle(g).lineHeight);

      // real baseline of the first line box
      const probe = document.createElement('span');
      probe.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
      g.insertBefore(probe, g.firstChild);
      const base = probe.getBoundingClientRect().top - g.getBoundingClientRect().top;
      probe.remove();

      return { L1, L2, L3, L4, base, capAsc, ascAsc, xAsc, yDesc, band, F: parseFloat(cs.fontSize), geo, fm };
    });

    const ascTop  = m.base - m.ascAsc;
    const capTop  = m.base - m.capAsc;
    const xTop    = m.base - m.xAsc;
    const descBot = m.base + m.yDesc;

    (near(capTop,  m.L1, 2) ? ok : bad)('F-2 capital   → L1', `ink ${capTop.toFixed(1)} vs rule ${m.L1.toFixed(1)}`);
    (near(xTop,    m.L2, 2) ? ok : bad)('F-2 x-height  → L2', `ink ${xTop.toFixed(1)} vs rule ${m.L2.toFixed(1)}`);
    (near(m.base,  m.L3, 1) ? ok : bad)('F-2 baseline  → L3', `ink ${m.base.toFixed(1)} vs rule ${m.L3.toFixed(1)}`);
    (near(descBot, m.L4, 2) ? ok : bad)('F-2 descender → L4', `ink ${descBot.toFixed(1)} vs rule ${m.L4.toFixed(1)}`);

    // Ascenders now rise past L1. They must stay inside the gap and never reach
    // the bottom rule of the block above (which sits one band higher).
    const prevL4 = m.L4 - m.band;
    (ascTop > prevL4 ? ok : bad)('F-2 ascender clears block above',
      `ascender top ${ascTop.toFixed(1)} vs previous L4 ${prevL4.toFixed(1)} (여유 ${(ascTop - prevL4).toFixed(1)}px)`);
    console.log(`    · ascender rises ${(m.L1 - ascTop).toFixed(1)}px above L1; gap is ${(m.band - (m.L4 - m.L1)).toFixed(1)}px (font-size ${m.F.toFixed(1)}px)`);

    // Regression guard: background-position for L4 must not exceed the tile
    // height, or repeat-y wraps it back to the TOP of the same block and a
    // phantom rule appears above L1 (the bug this fix addresses).
    const noWrap = m.L1 < m.L2 && m.L2 < m.L3 && m.L3 < m.L4 && m.L4 <= m.band + 0.5;
    (noWrap ? ok : bad)('F-2 no background-position wraparound',
      `L1 ${m.L1.toFixed(1)} < L2 ${m.L2.toFixed(1)} < L3 ${m.L3.toFixed(1)} < L4 ${m.L4.toFixed(1)} <= band ${m.band.toFixed(1)}`);
    await ctx.close();
  }

  /* ---------- F-3 English size/gap is uniform and line-count-independent ---------- */
  {
    const { ctx, page } = await fresh(browser, 1440, 900);
    const read = () => page.evaluate(() => {
      const rows = [...document.querySelectorAll('.row')].map(row => {
        const g = row.querySelector('.guide'), clip = row.querySelector('.ruleClip');
        return { F: parseFloat(getComputedStyle(g).fontSize), clipH: clip.getBoundingClientRect().height };
      });
      const ko = document.querySelector('.ko');
      const cs = getComputedStyle(ko);
      return { rows, koPx: parseFloat(cs.fontSize), koFamily: cs.fontFamily, koWeight: cs.fontWeight };
    });

    const one = await read();
    const fs = one.rows.map(r => r.F), clips = one.rows.map(r => r.clipH);
    const uniform = fs.every(f => Math.abs(f - fs[0]) < 0.5) && clips.every(h => Math.abs(h - clips[0]) < 1);
    (uniform ? ok : bad)('F-3 every row shares the same font size and window height',
      `F=[${fs.map(f => f.toFixed(1))}] clipH=[${clips.map(h => h.toFixed(1))}]`);

    // the gap this fixes was ~90-110px (36-45% of block height) before; it
    // should now be a small, fixed headroom, not proportional to that old bug
    const tight = clips[0] < fs[0] * 1.3;
    (tight ? ok : bad)('F-3 row window is tight (no oversized gap)', `clipH ${clips[0].toFixed(1)}px vs F ${fs[0].toFixed(1)}px`);

    (one.koPx >= 32 ? ok : bad)('F-4 Korean size is large', `${one.koPx.toFixed(1)}px (was 17px)`);
    (one.koFamily.toLowerCase().includes('pretendard') ? ok : bad)('F-4 Korean uses Pretendard', one.koFamily);
    (Number(one.koWeight) >= 700 ? ok : bad)('F-4 Korean is bold', `weight ${one.koWeight}`);

    // F-3's original premise (line count drives size) was reversed by design:
    // switching line count must NOT change the English size or gap at all.
    await page.evaluate(() => document.querySelectorAll('#lineCount button')[2].click());
    await page.waitForTimeout(200);
    const three = await read();
    const unaffected = Math.abs(three.rows[0].F - one.rows[0].F) < 0.5 &&
                        Math.abs(three.koPx - one.koPx) < 0.5;
    (unaffected ? ok : bad)('F-3/F-4 line count no longer resizes anything',
      `English N=1 ${one.rows[0].F.toFixed(1)}px → N=3 ${three.rows[0].F.toFixed(1)}px; Korean ${one.koPx.toFixed(1)}px → ${three.koPx.toFixed(1)}px`);
    await ctx.close();
  }

  /* ---------- F-16 typing a longer sentence refits the font (no manual layout() call otherwise) ---------- */
  {
    const { ctx, page } = await fresh(browser, 1440, 900);
    const before = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.guide')).fontSize));
    await page.evaluate(() => {
      const g = document.querySelector('.guide');
      g.textContent = 'My favorite subject at school this semester is definitely mathematics because it is fun.';
      g.dispatchEvent(new Event('input'));
    });
    await page.waitForTimeout(400);   // layoutSoon() debounce
    const after = await page.evaluate(() => {
      const g = document.querySelector('.guide');
      return { F: parseFloat(getComputedStyle(g).fontSize), overflowsWidth: g.scrollWidth > g.clientWidth + 2 };
    });
    (after.F < before && after.F >= 69 && !after.overflowsWidth ? ok : bad)(
      'F-16 long sentence refits without shrinking below the floor',
      `${before.toFixed(1)}px → ${after.F.toFixed(1)}px, overflow ${after.overflowsWidth}`);
    await ctx.close();
  }

  /* ---------- F-12 sentence-size slider ---------- */
  {
    const { ctx, page } = await fresh(browser, 1440, 900);
    const f100 = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.guide')).fontSize));
    await page.fill('#scale', '50');
    await page.locator('#scale').dispatchEvent('input');
    await page.waitForTimeout(150);
    const f50 = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.guide')).fontSize));
    (near(f50 / f100, 0.5, 0.02) ? ok : bad)('F-12 size slider scales English text',
      `100% → ${f100.toFixed(1)}px, 50% → ${f50.toFixed(1)}px (ratio ${(f50 / f100).toFixed(3)})`);

    const koUnchanged = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.ko')).fontSize));
    (koUnchanged >= 32 ? ok : bad)('F-12 Korean unaffected by size slider', `${koUnchanged.toFixed(1)}px`);
    await ctx.close();
  }

  /* ---------- F-5 per-row dim slider ---------- */
  {
    const { ctx, page } = await fresh(browser, 1440, 900);
    await page.locator('.row').first().locator('.rng').fill('30');
    await page.locator('.row').first().locator('.rng').dispatchEvent('input');
    await page.waitForTimeout(120);
    const c = await page.evaluate(() => [
      getComputedStyle(document.querySelectorAll('.guide')[0]).color,
      getComputedStyle(document.querySelectorAll('.guide')[1]).color,
      window.__app.state.rows[0].dim
    ]);
    (c[0] !== c[1] && c[2] === 30 ? ok : bad)('F-5 per-row dim', `row0 ${c[0]} · row1 ${c[1]} · stored ${c[2]}`);
    await ctx.close();
  }

  /* ---------- F-6 ink ---------- */
  {
    const { ctx, page } = await fresh(browser, 1440, 900);
    await page.click('#mDraw');
    await page.waitForTimeout(150);
    const box = await page.locator('.guide').first().boundingBox();
    const vp = page.viewportSize();
    const cxp = box.x + box.width / 2;
    const cyp = Math.min(box.y + box.height / 2, vp.height - 80);   // stay inside the viewport

    const hit = await page.evaluate(([x, y]) => {
      const e = document.elementFromPoint(x, y);
      return e ? e.id || e.tagName : 'none';
    }, [cxp, cyp]);
    (hit === 'ink' ? ok : bad)('F-6 canvas receives pointer', `elementFromPoint → ${hit}`);

    await page.mouse.move(cxp - 120, cyp - 20);
    await page.mouse.down();
    await page.mouse.move(cxp + 120, cyp + 30, { steps: 24 });
    await page.mouse.up();
    await page.waitForTimeout(120);

    const s = await page.evaluate(([sx, sy]) => {
      const st = window.__app.strokes;
      if (!st.length) return { n: 0 };
      const r = document.querySelector('#ink').getBoundingClientRect();
      const p0 = st[0].pts[0];
      return { n: st.length, pts: st[0].pts.length,
               dx: Math.abs(p0.x - (sx - r.left)), dy: Math.abs(p0.y - (sy - r.top)) };
    }, [cxp - 120, cyp - 20]);
    (s.n >= 1 ? ok : bad)('F-6 stroke recorded', `${s.n} stroke / ${s.pts} points`);
    (s.n >= 1 && s.dx <= 2 && s.dy <= 2 ? ok : bad)('F-6 coordinate accuracy', `Δ ${s.dx?.toFixed(2)}, ${s.dy?.toFixed(2)} px`);

    await page.click('#undo');
    const after = await page.evaluate(() => window.__app.strokes.length);
    (after === 0 ? ok : bad)('F-6 undo', `${after} strokes remain`);

    // pixels actually painted?
    const painted = await page.evaluate(() => {
      const c = document.querySelector('#ink');
      const g = c.getContext('2d');
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
      return n;
    });
    (painted === 0 ? ok : bad)('F-6 undo clears pixels', `${painted} opaque px after undo`);
    await ctx.close();
  }

  /* ---------- F-11 escaping ---------- */
  {
    const { ctx, page } = await fresh(browser, 1440, 900);
    const evil = 'He said "hi" & <b>bye</b>.';
    await page.evaluate(t => {
      const g = document.querySelector('.guide');
      g.textContent = t; g.dispatchEvent(new Event('input'));
    }, evil);
    await page.click('#addRow');
    await page.waitForTimeout(200);
    const r = await page.evaluate(() => ({
      first: document.querySelector('.guide').textContent,
      // `en` is now sanitized HTML (so a teacher can color a word) rather than
      // plain text — round-trip it back through the DOM to compare fairly.
      storedText: window.__app.plainTextOf(window.__app.state.rows[0].en),
      bold: document.querySelectorAll('.sheet b').length,
      script: document.querySelectorAll('.sheet script, .sheet img, .sheet a').length
    }));
    (r.first === evil && r.storedText === evil && r.bold === 0 && r.script === 0 ? ok : bad)(
      'F-11 no HTML injection', `text ${JSON.stringify(r.first)} · <b> ${r.bold} · other-tags ${r.script}`);
    await ctx.close();
  }

  /* ---------- F-7 persistence ---------- */
  {
    const { ctx, page } = await fresh(browser, 1440, 900);
    await page.evaluate(() => {
      const g = document.querySelector('.guide');
      g.textContent = 'Persisted sentence.'; g.dispatchEvent(new Event('input'));
      const k = document.querySelector('.ko');
      k.textContent = '저장된 문장.'; k.dispatchEvent(new Event('input'));
    });
    await page.waitForTimeout(500);
    await page.reload();
    await page.waitForFunction(() => window.__app && window.__app.fm);
    await page.waitForTimeout(250);
    const back = await page.evaluate(() => ({
      en: document.querySelector('.guide').textContent,
      ko: document.querySelector('.ko').textContent,
      inkPersisted: window.__app.strokes.length
    }));
    (back.en === 'Persisted sentence.' && back.ko === '저장된 문장.' ? ok : bad)(
      'F-7 reload restores', `${JSON.stringify(back.en)} / ${JSON.stringify(back.ko)}`);
    (back.inkPersisted === 0 ? ok : bad)('F-7 ink is session-only (by design)', `${back.inkPersisted} strokes`);
    await ctx.close();
  }

  /* ---------- F-9 print ---------- */
  {
    const { ctx, page } = await fresh(browser, 1440, 900);
    await page.emulateMedia({ media: 'print' });
    await page.waitForTimeout(200);
    const hidden = await page.evaluate(() => {
      const off = s => { const e = document.querySelector(s); return !e || e.offsetParent === null && getComputedStyle(e).display === 'none'; };
      return { bar: off('.bar'), fab: off('.fab'), tools: off('.rowtools'),
               guideVisible: document.querySelector('.guide').getBoundingClientRect().height > 0 };
    });
    (hidden.bar && hidden.fab && hidden.tools && hidden.guideVisible ? ok : bad)(
      'F-9 print hides UI', JSON.stringify(hidden));
    await ctx.close();
  }

  /* ---------- F-10 a11y ---------- */
  {
    const { ctx, page } = await fresh(browser, 1440, 900);
    const a = await page.evaluate(() => ({
      unlabelled: document.querySelectorAll('.bar button:not([aria-label]):not([aria-pressed])').length,
      enLang: document.querySelector('.guide').getAttribute('lang'),
      toolsHoverFree: getComputedStyle(document.querySelector('.rowtools')).opacity === '1',
      spans: document.querySelectorAll('.bar span[onclick]').length
    }));
    (a.enLang === 'en' && a.toolsHoverFree ? ok : bad)('F-10 a11y basics', JSON.stringify(a));
    await ctx.close();
  }

  /* ---------- F-13 Korean gloss never shows the browser's red spellcheck marks ---------- */
  {
    const { ctx, page } = await fresh(browser, 1440, 900);
    const s = await page.evaluate(() => {
      const ko = document.querySelector('.ko');
      return { spellcheck: ko.spellcheck, autocorrect: ko.getAttribute('autocorrect'), gramm: ko.getAttribute('data-gramm') };
    });
    (s.spellcheck === false && s.autocorrect === 'off' && s.gramm === 'false' ? ok : bad)(
      'F-13 Korean spellcheck disabled', JSON.stringify(s));
    await ctx.close();
  }

  /* ---------- F-14 word/phrase color highlighting ---------- */
  {
    const { ctx, page } = await fresh(browser, 1440, 900);

    // sanitizer: only the three whitelisted colors survive, everything else is stripped
    const san = await page.evaluate(() => {
      const app = window.__app;
      const evil = 'a <span style="color:#e0322b">red</span> <span style="color:lime">lime</span> ' +
                   '<b onclick="x">bold</b> <img src=x onerror=alert(1)> <script>alert(1)<\/script> end';
      const out = app.sanitizeInline(evil);
      const div = document.createElement('div'); div.innerHTML = out;
      return {
        html: out,
        text: div.textContent,
        allowedSpan: div.querySelectorAll('span[style*="rgb(224, 50, 43)"], span[style*="#e0322b"]').length,
        dangerous: div.querySelectorAll('script,img,b,[onclick],[onerror]').length
      };
    });
    (san.allowedSpan >= 1 && san.dangerous === 0 && san.text.includes('lime') && san.text.includes('bold')
      ? ok : bad)('F-14 sanitizer keeps only whitelisted color spans', JSON.stringify(san));

    // end-to-end: select part of a sentence and click the red swatch
    const guide = page.locator('.guide').first();
    await page.evaluate(() => {
      const g = document.querySelector('.guide');
      g.textContent = 'The apple is red.'; g.dispatchEvent(new Event('input'));
    });
    const box = await guide.boundingBox();
    // double-click the second word ("apple") to select it, independent of exact pixel metrics
    await page.evaluate(() => {
      const g = document.querySelector('.guide');
      const t = g.firstChild;
      const range = document.createRange();
      range.setStart(t, 4); range.setEnd(t, 9);   // "apple"
      const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
    });
    await page.waitForTimeout(150);
    const popVisible = await page.evaluate(() => !document.getElementById('colorpop').hidden);
    (popVisible ? ok : bad)('F-14 color popup appears on selection', `hidden=${!popVisible}`);

    if (popVisible) {
      await page.click('#colorpop button[data-c="#e0322b"]');
      await page.waitForTimeout(150);
      const applied = await page.evaluate(() => ({
        stored: window.__app.state.rows[0].en,
        renderedText: document.querySelector('.guide').textContent
      }));
      // the browser normalizes "#e0322b" to its rgb() form when serializing style.color
      const hasRedSpan = /color:\s*rgb\(224,\s*50,\s*43\)/.test(applied.stored);
      (hasRedSpan && applied.renderedText === 'The apple is red.'
        ? ok : bad)('F-14 color applied and persisted', JSON.stringify(applied));
    }
    await ctx.close();
  }

  /* ---------- F-15 speaker: prominent placement + 0.8x rate ---------- */
  {
    const { ctx, page } = await fresh(browser, 1440, 900);
    const layout_ = await page.evaluate(() => {
      const btn = document.querySelector('.row .speakBtn');
      const inTools = !!document.querySelector('.rowtools .speakBtn');
      const r = btn.getBoundingClientRect();
      return { exists: !!btn, inTools, w: r.width, h: r.height };
    });
    (layout_.exists && !layout_.inTools && layout_.w >= 44 ? ok : bad)(
      'F-15 speaker button is prominent, outside rowtools', JSON.stringify(layout_));

    await page.click('.row .speakBtn');
    await page.waitForTimeout(150);
    const rate = await page.evaluate(() => window.__app.lastRate);
    (rate === 0.8 ? ok : bad)('F-15 speech rate is 0.8x', `rate=${rate}`);
    await ctx.close();
  }

  /* ---------- F-8 PWA ---------- */
  {
    const { ctx, page } = await fresh(browser, 1440, 900);

    // F-8a manifest
    const man = await page.evaluate(async () => {
      const link = document.querySelector('link[rel=manifest]');
      if (!link) return { linked: false };
      const res = await fetch(link.href);
      if (!res.ok) return { linked: true, status: res.status };
      const j = await res.json();
      const icons = await Promise.all((j.icons || []).map(async i => {
        const r = await fetch(new URL(i.src, link.href));
        return { src: i.src, status: r.status };
      }));
      return { linked: true, status: 200, name: j.name, start_url: j.start_url,
               scope: j.scope, display: j.display, icons,
               maskable: (j.icons || []).some(i => (i.purpose || '').includes('maskable')) };
    });
    const manOk = man.linked && man.status === 200 && man.name && man.start_url &&
                  man.display === 'standalone' && man.maskable &&
                  man.icons.length >= 3 && man.icons.every(i => i.status === 200);
    (manOk ? ok : bad)('F-8a manifest + icons',
      manOk ? `"${man.name}" · ${man.display} · icons ${man.icons.length}/200`
            : JSON.stringify(man).slice(0, 160));

    // F-8b service worker reaches "activated"
    const swState = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready.catch(() => null);
      if (!reg) return 'no registration';
      for (let i = 0; i < 60 && !navigator.serviceWorker.controller; i++)
        await new Promise(r => setTimeout(r, 100));
      return (reg.active && reg.active.state) +
             (navigator.serviceWorker.controller ? ' / controlling' : ' / not controlling');
    });
    (swState.startsWith('activated') ? ok : bad)('F-8b service worker active', swState);

    // F-8c genuinely offline
    await ctx.setOffline(true);
    await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
    const offline = await page.evaluate(async () => {
      for (let i = 0; i < 80 && !(window.__app && window.__app.fm); i++)
        await new Promise(r => setTimeout(r, 100));
      const g = document.querySelector('.guide');
      const fontUrl = new URL('./fonts/Andika-Regular.woff2', location.href).href;
      let served = 'no';
      try { const r = await fetch(fontUrl); served = r.ok ? r.headers.get('content-type') : 'HTTP ' + r.status; }
      catch (e) { served = 'threw'; }
      return { booted: !!(window.__app && window.__app.fm),
               guideW: g ? Math.round(g.getBoundingClientRect().width) : 0,
               andika: document.fonts.check('100px Andika'), served };
    });
    (offline.booted && offline.guideW > 100 && offline.andika && offline.served === 'font/woff2' ? ok : bad)(
      'F-8c works offline',
      `booted ${offline.booted} · guide ${offline.guideW}px · Andika ${offline.andika} · font served ${offline.served}`);
    await ctx.setOffline(false);
    await ctx.close();
  }

  // F-8d icon files are really the sizes they claim
  {
    const { ctx, page } = await fresh(browser, 800, 600);
    const dims = await page.evaluate(async () => {
      const want = [['./icons/icon-192.png', 192], ['./icons/icon-512.png', 512], ['./icons/maskable-512.png', 512]];
      return Promise.all(want.map(([src, n]) => new Promise(res => {
        const im = new Image();
        im.onload = () => res({ src, n, w: im.naturalWidth, h: im.naturalHeight });
        im.onerror = () => res({ src, n, w: 0, h: 0 });
        im.src = src;
      })));
    });
    const good = dims.every(d => d.w === d.n && d.h === d.n);
    (good ? ok : bad)('F-8d icon dimensions', dims.map(d => `${d.w}x${d.h}`).join(' · '));
    await ctx.close();
  }

  await browser.close();

  console.log('');
  let fail = 0;
  for (const r of results) {
    if (!r.pass) fail++;
    console.log(`${r.pass ? '  PASS' : '  FAIL'}  ${r.n.padEnd(30)} ${r.d}`);
  }
  console.log(`\n  ${results.length - fail}/${results.length} passed\n`);
  process.exit(fail ? 1 : 0);
})();
