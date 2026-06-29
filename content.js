/*
 * Lioa — LinkedIn ohne Algo
 * -------------------------
 * Hides any home-feed post whose author isn't a 1st-degree connection.
 *
 * As of LinkedIn's 2025 "server-driven UI" feed rebuild, the markup is fully
 * obfuscated: class names are hashed (e.g. `_26ae297a`) and feed posts no
 * longer carry `data-urn`/`data-id`. The durable hooks that remain are:
 *   - the feed list:  [data-testid="mainFeed"]  (also data-component-type="LazyColumn")
 *   - a post:         [role="listitem"] inside that list
 *   - the author + degree:  an element whose aria-label reads
 *                           "<Name> [Verified Profile] <1st|2nd|3rd+>"
 *
 * We read the degree from the AUTHOR's aria-label rather than scanning the
 * post's visible text, because (a) verified authors render the degree next to
 * a badge icon (so it isn't a plain text leaf) and (b) a post's body can
 * contain a *commenter's* or social-proof person's degree ("Laura commented…
 * • 1st"), which a whole-post text scan would wrongly match. The first
 * aria-label in the post that carries a degree is the author's.
 *
 * If filtering breaks after a redesign, run `npm run inspect` (test/inspect-feed.mjs)
 * to dump the live DOM and update SELECTORS / the aria-label assumption below.
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

  // -------- state --------
  let enabled = localStorage.getItem("lcf-enabled") !== "off";
  let hiddenCount = 0;

  // The feed list's direct child that wraps this post. The feed is a flex column
  // with `gap: 8px`, and each post sits in a `display:contents` wrapper that is
  // the list's direct child. Hiding the post itself leaves that wrapper as a
  // zero-height flex item, so the 8px gap around it still shows — producing big
  // empty bands between kept posts and confusing the infinite-scroll trigger.
  // Hiding the WRAPPER instead removes it from the flex flow, collapsing the gap.
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

  function sweep() {
    const posts = feedPosts();
    const degrees = posts.map(authorDegree);
    const withDegree = degrees.filter(Boolean).length;

    // Fail-safe: if there are posts but NONE has a detectable degree, LinkedIn
    // probably changed the markup — show everything instead of blanking the
    // feed, and warn so it's obvious something needs updating.
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
    updateBadge();
  }

  // -------- floating on/off toggle --------
  let badgeEl;
  function buildToggle() {
    if (badgeEl && document.body.contains(badgeEl)) return;
    badgeEl = document.createElement("button");
    badgeEl.type = "button";
    Object.assign(badgeEl.style, {
      position: "fixed",
      bottom: "16px",
      right: "16px",
      zIndex: "99999",
      padding: "8px 12px",
      borderRadius: "20px",
      border: "none",
      font: "600 12px/1.2 system-ui, sans-serif",
      color: "#fff",
      cursor: "pointer",
      boxShadow: "0 2px 8px rgba(0,0,0,.25)",
    });
    badgeEl.addEventListener("click", () => {
      enabled = !enabled;
      localStorage.setItem("lcf-enabled", enabled ? "on" : "off");
      sweep();
    });
    document.body.appendChild(badgeEl);
    updateBadge();
  }

  function updateBadge() {
    if (!badgeEl) return;
    badgeEl.style.background = enabled ? "#0a66c2" : "#666";
    badgeEl.textContent = enabled ? `Filter ON · ${hiddenCount} hidden` : "Filter OFF";
  }

  // -------- run + watch the dynamic, infinite-scrolling feed --------
  let timer = null;
  function scheduleSweep() {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      buildToggle(); // SPA re-renders can drop the button; re-add if needed
      sweep();
    }, 300);
  }

  function start() {
    buildToggle();
    sweep();
    new MutationObserver(scheduleSweep).observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  if (document.body) start();
  else window.addEventListener("DOMContentLoaded", start);
})();
