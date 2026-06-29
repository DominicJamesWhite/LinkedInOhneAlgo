/*
 * Lioa — LinkedIn ohne Algo
 * -------------------------
 * Hides any home-feed post whose author isn't a 1st-degree connection.
 *
 * As of LinkedIn's 2025 "server-driven UI" feed rebuild, class names are hashed
 * (`_26ae297a`…) and posts no longer carry `data-urn`/`data-id`. Durable hooks:
 *   - the feed list:  [data-testid="mainFeed"]  (a data-component-type="LazyColumn")
 *   - a post:         [role="listitem"] inside that list
 *   - the author + degree:  an element whose aria-label reads
 *                           "<Name> [Verified Profile] <1st|2nd|3rd+>"
 *
 * We read the degree from the AUTHOR's aria-label rather than scanning the post's
 * visible text, because verified authors render the degree beside a badge icon
 * (not a plain text leaf) and a post body can contain a *commenter's* badge
 * ("Laura commented … • 1st") that a text scan would wrongly match.
 *
 * There is no in-page UI. The on/off preference and the live hidden-count are
 * shared with the toolbar popup via chrome.storage.local.
 *
 * If filtering breaks after a redesign, run `npm run inspect` (test/inspect-feed.mjs)
 * to dump the live DOM and update SELECTORS / the aria-label assumption.
 */
(() => {
  "use strict";

  // Debug: instead of hiding, dim + outline filtered posts in red. Also logs.
  const DEBUG = false;

  const SELECTORS = {
    // The feed list (server-driven "LazyColumn"). data-testid is the stable anchor.
    feed: '[data-testid="mainFeed"], [role="list"][data-component-type="LazyColumn"]',
    // A single feed post within the list.
    post: '[role="listitem"]',
  };

  // Matches a connection-degree token ("1st"/"2nd"/"3rd"/"3rd+") bounded by a
  // separator or string edge, so it won't match "21st" or "1st" inside a word.
  const DEGREE_RE = /(^|[\s·•‧|])(1st|2nd|3rd\+?)(?=[\s·•‧|]|$)/i;

  // chrome.storage works in both Chrome and Firefox (MV3) with the "storage"
  // permission. It's null when the script runs outside an extension (e.g. injected
  // by the test harness) — detection still works, there's just no popup sync.
  const store = (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) || null;
  const KEY_ENABLED = "lcf-enabled";
  const KEY_HIDDEN = "lcf-hidden";

  // -------- state --------
  let enabled = true; // default on; overridden by stored preference below
  let hiddenCount = 0;
  let lastPublished = null;

  // Top-level posts in the feed (skip nested listitems: comments, carousels).
  function feedPosts() {
    const out = [];
    document.querySelectorAll(SELECTORS.feed).forEach((feed) => {
      feed.querySelectorAll(SELECTORS.post).forEach((item) => {
        if (item.parentElement && item.parentElement.closest(SELECTORS.post)) return;
        out.push(item);
      });
    });
    return out;
  }

  // The author's connection degree for a post: "1st" | "2nd" | "3rd" | null.
  // The author is the first element whose (short) aria-label carries a degree.
  function authorDegree(post) {
    for (const el of post.querySelectorAll("[aria-label]")) {
      const label = el.getAttribute("aria-label") || "";
      if (!label || label.length > 80) continue; // author labels are short
      const m = label.match(DEGREE_RE);
      if (m) return m[2].toLowerCase();
    }
    return null;
  }

  // The feed list's direct child that wraps this post. The feed is a flex column
  // with `gap: 8px`, and each post sits in a `display:contents` wrapper that is
  // the list's direct child. Hiding the post itself leaves that wrapper as a
  // zero-height flex item, so the gap around it still shows (empty bands, and the
  // leftover height confuses infinite scroll). Hiding the WRAPPER collapses it.
  function slotOf(post) {
    const feed = post.closest(SELECTORS.feed);
    if (!feed) return post;
    let el = post;
    while (el.parentElement && el.parentElement !== feed) el = el.parentElement;
    return el;
  }

  function setHidden(post, nowHidden) {
    post.dataset.lcfHidden = nowHidden ? "1" : "0";
    if (DEBUG) {
      // Dim in place — the slot is display:contents, so style the post itself.
      post.style.outline = nowHidden ? "2px solid red" : "";
      post.style.opacity = nowHidden ? "0.35" : "";
      return;
    }
    // The wrapper's display:contents comes from a class (no inline style), so
    // setting display:'' cleanly restores it. Only write when it changes.
    const slot = slotOf(post);
    const target = nowHidden ? "none" : "";
    if (slot.style.display !== target) slot.style.display = target;
  }

  // Share the live count with the popup (only when it changed).
  function publish() {
    if (!store || hiddenCount === lastPublished) return;
    lastPublished = hiddenCount;
    store.set({ [KEY_HIDDEN]: hiddenCount });
  }

  function sweep() {
    const posts = feedPosts();
    const degrees = posts.map(authorDegree);
    const withDegree = degrees.filter(Boolean).length;

    // Fail-safe: if there are posts but NONE has a detectable degree, LinkedIn
    // probably changed the markup — show everything instead of blanking the feed.
    const failSafe = enabled && posts.length >= 3 && withDegree === 0;

    let hidden = 0;
    posts.forEach((post, i) => {
      const keep = !enabled || failSafe || degrees[i] === "1st";
      setHidden(post, !keep);
      if (post.dataset.lcfHidden === "1") hidden++;
    });
    hiddenCount = hidden;

    if (failSafe) {
      console.warn(
        `[LCF] ${posts.length} posts but no degree detected — failing safe (showing all). Run \`npm run inspect\` to refresh selectors.`,
      );
    }
    console.debug(
      `[LCF] posts=${posts.length} withDegree=${withDegree} kept=${posts.length - hidden} hidden=${hidden}${failSafe ? " (FAIL-SAFE)" : ""}`,
    );
    publish();
  }

  // -------- run + watch the dynamic, infinite-scrolling feed --------
  let timer = null;
  function scheduleSweep() {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      sweep();
    }, 300);
  }

  function start() {
    sweep();
    new MutationObserver(scheduleSweep).observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  // Load the stored on/off preference, and react to the popup toggling it.
  if (store) {
    store.get(KEY_ENABLED, (res) => {
      if (res && typeof res[KEY_ENABLED] === "boolean" && res[KEY_ENABLED] !== enabled) {
        enabled = res[KEY_ENABLED];
        sweep();
      }
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !changes[KEY_ENABLED]) return;
      const v = changes[KEY_ENABLED].newValue;
      if (typeof v === "boolean" && v !== enabled) {
        enabled = v;
        sweep();
      }
    });
  }

  if (document.body) start();
  else window.addEventListener("DOMContentLoaded", start);
})();
