/*
 * Live-DOM harness — surgical pass.
 * Walks the full ancestor ladder up from a degree-badge ("1st"/"2nd"/"3rd")
 * text node and enumerates the real structural hooks (role/article/data-*),
 * so we can identify today's obfuscated post + actor containers.
 *
 *   npm run inspect   # dump the ladder + hooks
 *   npm run verify    # after fixing content.js: assert posts get hidden
 *
 * Profile (your LinkedIn session): $LI_PROFILE_DIR
 * (default ~/.cache/li-connection-filter/profile). Never transmitted.
 */
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { homedir } from "node:os";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXT_DIR = resolve(__dirname, "..");
const PROFILE_DIR =
  process.env.LI_PROFILE_DIR || join(homedir(), ".cache", "li-connection-filter", "profile");
const REPORT_PATH = join(EXT_DIR, "test", "last-report.json");
const MODE = (process.argv[2] || "inspect").toLowerCase();
const FEED = "https://www.linkedin.com/feed/";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function settle(page) {
  console.log("→ Navigating to /feed/ …");
  await page.goto(FEED, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
  await sleep(4000);
  for (let i = 0; i < 8; i++) {
    await page.mouse.wheel(0, 2000).catch(() => {});
    await sleep(900);
  }
  await page.mouse.wheel(0, -9000).catch(() => {});
  await sleep(1500);
}

// Validate the proposed detection logic against the live feed.
function probe() {
  const DEG = /(^|[\s·•‧|])(1st|2nd|3rd\+?)(?=[\s·•‧|]|$)/i;
  const firstDegreeIn = (root) => {
    if (!root) return null;
    for (const el of root.querySelectorAll("*")) {
      if (el.children.length !== 0) continue;
      const t = (el.textContent || "").trim();
      if (t && t.length <= 24) {
        const m = t.match(DEG);
        if (m) return m[2].toLowerCase();
      }
    }
    return null;
  };
  const feed = document.querySelector('[data-testid="mainFeed"]');
  const items = feed ? [...feed.querySelectorAll('[role="listitem"]')] : [];
  const topItems = items.filter((it) => !it.parentElement || !it.parentElement.closest('[role="listitem"]'));
  const slotOf = (post) => {
    if (!feed) return post;
    let el = post;
    while (el.parentElement && el.parentElement !== feed) el = el.parentElement;
    return el;
  };
  const rows = topItems.map((it, i) => {
    const slot = slotOf(it);
    const hdr = it.querySelector('[data-sdui-anchor-id^="feed-header-"]');
    let aria = null;
    for (const e of it.querySelectorAll("[aria-label]")) {
      const a = e.getAttribute("aria-label");
      if (a && a.length < 70 && DEG.test(a)) {
        aria = a;
        break;
      }
    }
    const headerDegree = firstDegreeIn(hdr || it);
    return {
      i,
      hasHeader: !!hdr,
      aria,
      headerDegree,
      wholePostDegree: firstDegreeIn(it),
      // What the REAL content.js decided (data-lcf-hidden it set), if injected:
      lcf: it.getAttribute("data-lcf-hidden"),
      // The wrapper actually hidden — confirms the slot collapses (no gap):
      slotDisplay: getComputedStyle(slot).display,
      slotHeight: slot.offsetHeight,
      preview: (it.textContent || "").replace(/\s+/g, " ").trim().slice(0, 70),
    };
  });
  const toggle = [...document.querySelectorAll("button")].find((b) => /Filter (ON|OFF)/.test(b.textContent || ""));
  return {
    url: location.href,
    toggleButtonPresent: !!toggle,
    toggleButtonText: toggle ? toggle.textContent : null,
    feedHeight: feed ? feed.offsetHeight : null,
    mainFeedCount: document.querySelectorAll('[data-testid="mainFeed"]').length,
    listitemInFeed: items.length,
    topItems: topItems.length,
    globalListitem: document.querySelectorAll('[role="listitem"]').length,
    feedHeaders: document.querySelectorAll('[data-sdui-anchor-id^="feed-header-"]').length,
    rows,
    lcfSeen: document.querySelectorAll("[data-lcf-hidden]").length,
    lcfHidden: document.querySelectorAll('[data-lcf-hidden="1"]').length,
  };
}

function diagnose() {
  const clsStr = (el) => (typeof el.className === "string" ? el.className : el.getAttribute?.("class") || "");
  const dataOf = (el) =>
    Object.fromEntries(
      [...(el.attributes || [])]
        .filter((a) => /^(data-|role|aria-label|aria-describedby)/.test(a.name))
        .map((a) => [a.name, String(a.value).slice(0, 70)]),
    );
  const info = (el) => ({
    tag: el.tagName?.toLowerCase(),
    id: el.id || null,
    cls: clsStr(el).slice(0, 140),
    attrs: dataOf(el),
    kids: el.childElementCount ?? 0,
    desc: el.querySelectorAll ? el.querySelectorAll("*").length : 0,
    textLen: (el.textContent || "").trim().length,
    htmlHead: (el.outerHTML || "").slice(0, 160),
  });

  const re = /(^|[\s·•‧|])(1st|2nd|3rd\+?)(?=[\s·•‧|]|$)/i;
  const leaves = [];
  for (const el of document.querySelectorAll("*")) {
    if (el.children.length !== 0) continue;
    const t = (el.textContent || "").trim();
    if (t && t.length <= 30 && re.test(t)) leaves.push(el);
  }

  // Full ladder from the first degree leaf up to <body>.
  const ladder = [];
  if (leaves[0]) {
    let p = leaves[0];
    for (let i = 0; i < 24 && p && p.tagName !== "BODY"; i++) {
      ladder.push({ depth: i, ...info(p) });
      p = p.parentElement;
    }
  }

  const hook = (sel) => {
    let els = [];
    try {
      els = [...document.querySelectorAll(sel)];
    } catch {}
    return { sel, count: els.length, sample: els.slice(0, 6).map(info) };
  };
  const valuesOf = (attr) => {
    const m = {};
    for (const e of document.querySelectorAll(`[${attr}]`)) {
      const v = e.getAttribute(attr);
      m[v] = (m[v] || 0) + 1;
    }
    return m;
  };

  return {
    url: location.href,
    title: document.title,
    bodyTextLen: (document.body.innerText || "").length,
    nDegreeLeaves: leaves.length,
    degreeTexts: leaves.slice(0, 12).map((e) => (e.textContent || "").trim()),
    ladder,
    hooks: {
      article: hook("article"),
      roleArticle: hook('[role="article"]'),
      roleRegion: hook('[role="region"]'),
      ariaDescribedby: hook("[aria-describedby]"),
      componentType: { count: document.querySelectorAll("[data-component-type]").length, values: valuesOf("data-component-type") },
      sduiAnchor: { count: document.querySelectorAll("[data-sdui-anchor-id]").length, values: valuesOf("data-sdui-anchor-id") },
      pageCard: hook("[data-page-card]"),
      testid: valuesOf("data-testid"),
    },
    lcfSeen: document.querySelectorAll("[data-lcf-hidden]").length,
    lcfHidden: document.querySelectorAll('[data-lcf-hidden="1"]').length,
  };
}

// Where does inter-post spacing come from, and which element collapses cleanly
// when hidden? Dumps computed layout for the feed list + a post's ancestor chain.
function spacingProbe() {
  const feed = document.querySelector('[data-testid="mainFeed"], [role="list"][data-component-type="LazyColumn"]');
  if (!feed) return { error: "no feed found" };
  const cs = (el) => {
    const s = getComputedStyle(el);
    return {
      display: s.display,
      marginTop: s.marginTop,
      marginBottom: s.marginBottom,
      paddingTop: s.paddingTop,
      paddingBottom: s.paddingBottom,
      offsetHeight: el.offsetHeight,
      inlineStyle: el.getAttribute("style") || null,
      cls: (typeof el.className === "string" ? el.className : "").slice(0, 50),
    };
  };
  const fs = getComputedStyle(feed);
  const items = [...feed.querySelectorAll('[role="listitem"]')].filter(
    (it) => !it.parentElement || !it.parentElement.closest('[role="listitem"]'),
  );
  const sample = items[0];
  const chain = [];
  if (sample) {
    let el = sample;
    for (let i = 0; i < 10 && el && el !== feed; i++) {
      chain.push({ depth: i, tag: el.tagName.toLowerCase(), role: el.getAttribute("role"), directChildOfFeed: el.parentElement === feed, ...cs(el) });
      el = el.parentElement;
    }
  }
  return {
    feed: { display: fs.display, flexDirection: fs.flexDirection, gap: fs.gap, rowGap: fs.rowGap, cls: (typeof feed.className === "string" ? feed.className : "").slice(0, 50) },
    nItems: items.length,
    feedDirectChildren: [...feed.children].slice(0, 6).map((c) => ({ tag: c.tagName.toLowerCase(), ...cs(c) })),
    sampleChain: chain,
  };
}

async function main() {
  mkdirSync(PROFILE_DIR, { recursive: true });
  console.log(`Profile : ${PROFILE_DIR}\nExtension: ${EXT_DIR}\nMode    : ${MODE}\n`);

  // LI_CHANNEL="chrome" (default) drives installed Google Chrome — which under
  // automation IGNORES --load-extension, so verify falls back to page.evaluate.
  // LI_CHANNEL="" uses Playwright's bundled Chrome for Testing, which DOES honor
  // --load-extension, so we can confirm native extension injection in Chromium.
  const CHANNEL = process.env.LI_CHANNEL === undefined ? "chrome" : process.env.LI_CHANNEL;
  const launchOpts = {
    headless: false,
    viewport: null,
    args: [`--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`, "--no-first-run", "--no-default-browser-check"],
  };
  if (CHANNEL) launchOpts.channel = CHANNEL;
  console.log(`Browser : ${CHANNEL || "Chrome for Testing (bundled)"}`);
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, launchOpts);

  const lcfLogs = [];
  ctx.on("console", (msg) => {
    const t = msg.text();
    if (t.includes("[LCF]")) (lcfLogs.push(t), console.log("   " + t));
  });

  const page = ctx.pages()[0] || (await ctx.newPage());
  page.on("pageerror", (e) => console.log("   PAGEERROR:", e.message));
  console.log(`Loaded extension contexts: serviceWorkers=${ctx.serviceWorkers().length} backgroundPages=${(ctx.backgroundPages?.() || []).length}`);
  await settle(page);
  await sleep(1000);

  if (MODE === "spacing") {
    const s = await page.evaluate(spacingProbe);
    console.log("\n================ SPACING REPORT ================");
    console.log(JSON.stringify(s, null, 2));
    console.log("===============================================");
    writeFileSync(REPORT_PATH, JSON.stringify(s, null, 2));
    await sleep(1500);
    await ctx.close();
    return;
  }

  // Chrome's automation build often refuses to inject unpacked-extension content
  // scripts (--load-extension is ignored). The Firefox extension is unaffected;
  // to verify the REAL code here we inject content.js straight into the page.
  const hasToggle = await page.evaluate(() =>
    [...document.querySelectorAll("button")].some((b) => /Filter (ON|OFF)/.test(b.textContent || "")),
  );
  if (!hasToggle) {
    console.log("Extension not auto-injected by Chrome → running content.js via page.evaluate (CSP-exempt) to test the real code…");
    const src = readFileSync(join(EXT_DIR, "content.js"), "utf8");
    // page.evaluate executes through CDP (not subject to the page CSP that
    // blocks addScriptTag). The file is a self-invoking IIFE, so evaluating
    // the source string runs it exactly as a content script would.
    await page.evaluate(src).catch((e) => console.log("   eval failed:", e.message));
    await sleep(1800); // let the debounced sweep run
  }

  const report = await page.evaluate(probe);
  report.mode = MODE;
  report.lcfLogs = lcfLogs;

  console.log("\n================ PROBE REPORT ================");
  console.log(`URL: ${report.url}`);
  console.log(`TOGGLE BUTTON present=${report.toggleButtonPresent} text=${JSON.stringify(report.toggleButtonText)}  (proves content.js ran?)`);
  console.log(`mainFeed=${report.mainFeedCount}  topPosts=${report.topItems}  feedHeight=${report.feedHeight}px  (should ≈ sum of KEPT posts only if gaps collapsed)`);
  console.log("\nPer-post classification (header-scoped degree → keep?):");
  for (const r of report.rows) {
    const verdict = r.lcf === "1" ? "HIDDEN" : r.lcf === "0" ? "kept  " : "  -   ";
    console.log(
      `  #${String(r.i).padStart(2)} content.js=${verdict} slot[display=${String(r.slotDisplay).padEnd(8)} h=${String(r.slotHeight).padStart(4)}]  aria=${JSON.stringify(r.aria)}`,
    );
    console.log(`        "${r.preview}"`);
  }
  console.log(`\nExtension self-report: lcfSeen=${report.lcfSeen} lcfHidden=${report.lcfHidden}`);
  if (report.lcfLogs.length) console.log("LCF logs:\n  " + report.lcfLogs.join("\n  "));
  console.log("==============================================\n");

  if (MODE === "verify") {
    const pass = report.lcfSeen > 0 && report.lcfHidden > 0;
    console.log(pass ? "✅ VERIFY PASS" : "❌ VERIFY FAIL: nothing hidden.");
    report.verifyPass = pass;
  }

  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(`Full report → ${REPORT_PATH}`);
  await sleep(2000);
  await ctx.close();
}

main().catch((e) => {
  console.error("Harness error:", e);
  process.exit(1);
});
