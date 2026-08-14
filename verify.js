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
      const L1 = pos[0], L2 = pos[1], L3 = pos[2], L4 = pos[3] + 2;

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
    await ctx.close();
  }

  /* ---------- F-3 / F-4 sizing driven by line count ---------- */
  {
    const { ctx, page } = await fresh(browser, 1440, 900);
    const one = await page.evaluate(() => {
      const st = document.querySelector('.stage').clientHeight;
      const g  = document.querySelector('.guide').getBoundingClientRect().height;
      return { ratio: g / st, ko: parseFloat(getComputedStyle(document.querySelector('.ko')).fontSize) };
    });
    (one.ratio >= 0.70 ? ok : bad)('F-3 N=1 fills screen', `guide/stage = ${(one.ratio * 100).toFixed(0)}%`);

    await page.evaluate(() => document.querySelectorAll('#lineCount button')[2].click());
    await page.waitForTimeout(200);
    const three = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.ko')).fontSize));
    (three >= 32 ? ok : bad)('F-4 Korean size @N=3', `${three.toFixed(1)}px (was 17px)`);
    console.log(`    · Korean: N=1 → ${one.ko.toFixed(0)}px, N=3 → ${three.toFixed(0)}px`);
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
      stored: window.__app.state.rows[0].en,
      bold: document.querySelectorAll('.sheet b').length
    }));
    (r.first === evil && r.stored === evil && r.bold === 0 ? ok : bad)(
      'F-11 no HTML injection', `text ${JSON.stringify(r.first)} · <b> ${r.bold}`);
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
