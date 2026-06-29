"use strict";
// Popup UI for Lioa. State is shared with the content script via chrome.storage.local:
//   lcf-enabled : boolean preference (written here, read + applied by content.js)
//   lcf-hidden  : live hidden count (written by content.js, shown here)
const store = chrome.storage.local;
const KEY_ENABLED = "lcf-enabled";
const KEY_HIDDEN = "lcf-hidden";

const toggle = document.getElementById("toggle");
const countEl = document.getElementById("count");
const countLabel = document.getElementById("countLabel");
const foot = document.getElementById("foot");

function render(enabled, hidden) {
  toggle.checked = enabled;
  if (enabled) {
    countEl.textContent = String(hidden);
    countEl.style.opacity = "1";
    countLabel.textContent = hidden === 1 ? "post hidden" : "posts hidden";
    foot.textContent = "Showing only your 1st-degree connections.";
  } else {
    countEl.textContent = "—";
    countEl.style.opacity = "0.5";
    countLabel.textContent = "filter is off";
    foot.textContent = "Showing all posts.";
  }
}

function read() {
  store.get([KEY_ENABLED, KEY_HIDDEN], (res) => {
    render(res[KEY_ENABLED] !== false, res[KEY_HIDDEN] || 0); // default ON
  });
}

toggle.addEventListener("change", () => {
  store.set({ [KEY_ENABLED]: toggle.checked });
  // Optimistic update; content.js re-sweeps and writes the real count back.
  render(toggle.checked, toggle.checked ? Number(countEl.textContent) || 0 : 0);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes[KEY_ENABLED] || changes[KEY_HIDDEN])) read();
});

read();
