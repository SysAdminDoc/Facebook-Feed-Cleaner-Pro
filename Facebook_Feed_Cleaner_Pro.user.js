// ==UserScript==
// @name         Facebook Feed Cleaner Pro (Advanced)
// @namespace    https://github.com/SysAdminDoc/Facebook-Feed-Cleaner-Pro/
// @version      4.2
// @description  Declutter Facebook by identifying unwanted posts (sponsored, suggested, keywords), analyzing their structure, exporting diagnostics, and optionally unfollowing sources with friend protection. Dark-first premium UI, feed-scoped scanning, stable element picker, dry-run batch, whitelist, and toasts.
// @author       Matthew Parker
// @match        https://www.facebook.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // -----------------------------
  // CONFIGURATION & STATE
  // -----------------------------
  const CONFIG = {
    feedSelector: 'div[role="feed"], div[data-pagelet*="FeedUnit"]',
    // Facebook frequently uses role="article" on feed posts
    postSelector: 'div[role="article"]',

    // Actor (source) detection
    actorLinkSelectors: [
      'h2 a[role="link"]',
      'h3 a[role="link"]',
      'strong a[role="link"]',
      'span > a[role="link"][aria-hidden="false"]',
      'a[aria-label][role="link"]',
      'a[href*="/groups/"]',
      'a[href*="/pages/"]',
      'a[href^="/people/"]',
      'a[href^="/profile.php"]'
    ],

    // Post menu button patterns (kitchen-sink approach; we’ll pick the first that exists)
    postMenuSelectors: [
      'div[aria-label="More"]',
      'div[aria-label="Actions for this post"]',
      'div[role="button"][aria-haspopup="menu"]',
      'div[aria-haspopup="menu"][role="button"]',
      'div[aria-label][role="button"][tabindex="0"]'
    ],

    // Menu items (we check textContent case-insensitively)
    unfollowMenuPhrases: [
      'unfollow',
      'hide all from',
      'stop seeing posts from',
      'see fewer posts from'
    ],
    confirmPhrases: [
      'unfollow',
      'hide all from',
      'confirm',
      'done',
      'ok'
    ],
    cancelPhrases: [
      'not now',
      'cancel',
      'close',
      'dismiss'
    ],

    // Friend heuristics (lightweight text hints present in the post context around the actor)
    friendHints: ['friends', 'mutual', 'followed by', 'are friends', 'is friends with'],

    // Detection indicators
    sponsoredIndicators: ['Sponsored', 'a[href*="/ads/about/"]'],
    suggestedIndicators: ['Suggested for you', 'People you may know'],

    // Timers
    scanInterval: 1600,
    scrollInterval: 3000,
    scrollAmount: 750,

    // Attributes
    processedAttr: 'data-ffcp-processed'
  };

  const state = {
    // Settings
    autoUnfollow: false,
    dryRun: true,
    protectFriends: true,
    hideSponsored: true,
    hideSuggested: true,
    keywordList: [],
    autoScroll: false,
    logPosts: true,
    highlightPosts: true,

    whitelist: [],

    // Runtime
    isPanelOpen: false,
    feedObserver: null,
    scrollTimer: null,

    // Data
    loggedPostsData: [],
    analysis: [],
    pendingTargets: [],   // {name, link, reason, isFriend}
    executedTargets: [],  // executed results
    unfollowedThisSession: new Set(),

    stats: {
      processed: 0,
      unfollowed: 0,
      hidden: 0,
      protected: 0,
      errors: 0
    }
  };

  // -----------------------------
  // UTILITIES
  // -----------------------------
  const qs = (sel, el = document) => el.querySelector(sel);
  const qsa = (sel, el = document) => Array.from(el.querySelectorAll(sel));
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const clip = (s, n = 240) => (s || '').trim().replace(/\s+/g, ' ').slice(0, n) + ((s || '').length > n ? '…' : '');

  function caseIncludes(hay, needle) {
    return (hay || '').toLowerCase().includes((needle || '').toLowerCase());
  }

  function anySelector(root, selectors) {
    for (const s of selectors) {
      const el = root.querySelector(s);
      if (el) return el;
    }
    return null;
  }

  function markProcessed(post) {
    if (post.hasAttribute(CONFIG.processedAttr)) return false;
    post.setAttribute(CONFIG.processedAttr, '1');
    return true;
  }

  function toast(message, type = 'info', duration = 3000) {
    let wrap = qs('#ffcp-toasts');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'ffcp-toasts';
      document.body.appendChild(wrap);
    }
    const t = document.createElement('div');
    t.className = `ffcp-toast ${type}`;
    t.textContent = message;
    wrap.appendChild(t);
    setTimeout(() => {
      t.classList.add('hide');
      setTimeout(() => t.remove(), 220);
    }, duration);
  }

  // -----------------------------
  // DETECTION
  // -----------------------------
  function isSponsored(post) {
    const t = post.innerText || '';
    for (const h of CONFIG.sponsoredIndicators) {
      if (h.startsWith('a[')) { if (qs(h, post)) return true; }
      else if (t.includes(h)) return true;
    }
    return false;
  }

  function isSuggested(post) {
    const t = post.innerText || '';
    return CONFIG.suggestedIndicators.some(h => t.includes(h));
  }

  function matchesKeywords(post) {
    if (!state.keywordList.length) return false;
    const t = (post.innerText || '').toLowerCase();
    return state.keywordList.some(k => t.includes(k.toLowerCase()));
  }

  function classify(post) {
    if (state.hideSponsored && isSponsored(post)) return 'Sponsored';
    if (state.hideSuggested && isSuggested(post)) return 'Suggested';
    if (matchesKeywords(post)) return 'Keyword Match';
    return null;
  }

  function findActor(post) {
    // Prefer visible link in the actor area
    let linkEl = null;
    for (const sel of CONFIG.actorLinkSelectors) {
      const cand = qs(sel, post);
      if (cand?.href) { linkEl = cand; break; }
    }
    if (!linkEl) return null;

    const name = (linkEl.innerText || linkEl.getAttribute('aria-label') || '').trim();
    const href = linkEl.href;
    const text = (post.innerText || '').toLowerCase();
    const isGroup = /\/groups\//.test(href);
    const isPage = /\/pages\//.test(href);
    const looksPerson = href.includes('/profile.php') || href.includes('/people/');
    const friendish = CONFIG.friendHints.some(h => text.includes(h.toLowerCase()));
    const isFriend = looksPerson && friendish && !isGroup && !isPage;

    return { name, link: href, isGroup, isPage, isFriend };
  }

  // -----------------------------
  // ACTIONS
  // -----------------------------
  function hidePost(post, reason) {
    if (state.highlightPosts) post.style.outline = '2px solid #fd7e14';
    post.style.transition = 'opacity .25s ease';
    post.style.opacity = '0';
    setTimeout(() => { post.style.display = 'none'; }, 250);
    post.setAttribute('data-ffcp-hidden-reason', reason);
    state.stats.hidden++;
  }

  async function unfollowSourceOfPost(post, reason, actor) {
    if (!actor || !actor.link || !actor.name) {
      toast('Cannot unfollow: missing source info', 'error', 2500);
      state.stats.errors++;
      return;
    }

    // Whitelist check
    if (state.whitelist.includes(actor.name)) {
      hidePost(post, `Whitelisted: ${actor.name}`);
      return;
    }

    // Friend protection
    if (state.protectFriends && actor.isFriend) {
      toast(`Protected friend: ${actor.name}`, 'info', 1800);
      hidePost(post, `Protected Friend: ${actor.name}`);
      state.stats.protected++;
      return;
    }

    // Session dedupe
    if (state.unfollowedThisSession.has(actor.link)) {
      hidePost(post, `Already Unfollowed: ${actor.name}`);
      return;
    }

    // Dry run mode
    if (state.dryRun) {
      state.pendingTargets.push({ source: actor, reason, dryRun: true });
      updateUnfollowCounts();
      hidePost(post, `Dry-Run: ${actor.name}`);
      return;
    }

    try {
      // Open menu
      const menuBtn = anySelector(post, CONFIG.postMenuSelectors);
      if (!menuBtn) throw new Error('Menu button not found');
      menuBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      await sleep(350);

      // Find menu items (menu is often portal-mounted under body)
      const menuItems = qsa('[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]', document.body);
      if (!menuItems.length) throw new Error('Menu did not open');

      const target = menuItems.find(mi => {
        const t = (mi.innerText || '').toLowerCase();
        return CONFIG.unfollowMenuPhrases.some(p => t.includes(p));
      });
      if (!target) throw new Error('Unfollow/hide-all option not found');

      target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      await sleep(300);

      // Confirm if needed
      const buttons = qsa('div[role="dialog"] [role="button"], div[role="dialog"] button, [aria-label]', document.body);
      const confirm = buttons.find(b => caseIncludes(b.textContent || b.getAttribute('aria-label') || '', 'unfollow')
                                     || CONFIG.confirmPhrases.some(p => caseIncludes(b.textContent || b.getAttribute('aria-label') || '', p)));
      if (confirm) {
        confirm.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        await sleep(200);
      }

      state.unfollowedThisSession.add(actor.link);
      state.stats.unfollowed++;
      state.executedTargets.push({ source: actor, reason, success: true });
      hidePost(post, `Unfollowed: ${actor.name}`);
      toast(`Unfollowed ${actor.name}`, 'success', 1400);
      updateUnfollowCounts();
    } catch (err) {
      state.executedTargets.push({ source: actor, reason, success: false, error: String(err) });
      state.stats.errors++;
      toast(`Unfollow failed: ${err.message || err}`, 'error', 2200);
      // Try to close any open dialog
      const closer = qsa('[aria-label="Close"], [data-testid="x_close_button"], [role="dialog"] [role="button"]', document.body)
        .find(b => /close/i.test(b.textContent || b.getAttribute('aria-label') || ''));
      if (closer) closer.click();
    }
  }

  async function processPost(post) {
    if (!markProcessed(post)) return;

    if (state.highlightPosts) {
      post.style.outline = '2px solid #6aa2ff';
      setTimeout(() => { post.style.outline = ''; }, 1000);
    }

    const reason = classify(post);
    const actor = findActor(post);

    logPost(post, reason, actor);
    state.stats.processed++;

    if (!reason) return;

    if (state.autoUnfollow) {
      await unfollowSourceOfPost(post, reason, actor);
    } else {
      hidePost(post, `Hiding: ${reason}`);
    }

    updateStats();
  }

  // -----------------------------
  // FEED SCANNING
  // -----------------------------
  async function scanFeed() {
    const feeds = qsa(CONFIG.feedSelector);
    if (!feeds.length) return;
    for (const feed of feeds) {
      const posts = qsa(CONFIG.postSelector, feed);
      for (const post of posts) {
        await processPost(post);
      }
    }
  }

  // -----------------------------
  // LOGGING & EXPORT
  // -----------------------------
  function logPost(post, reason, actor) {
    if (!state.logPosts) return;
    const entry = {
      ts: new Date().toISOString(),
      reason: reason || 'Scanned',
      actorName: actor?.name || 'Unknown',
      actorLink: actor?.link || 'Unknown',
      friend: !!actor?.isFriend,
      excerpt: clip(post.innerText, 220)
    };
    state.loggedPostsData.unshift(entry);
    if (state.loggedPostsData.length > 300) state.loggedPostsData.pop();
    updateLogPanel();
  }

  async function copyJSON(data, label = 'data') {
    const text = JSON.stringify(data, null, 2);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      toast(`${label} copied to clipboard`, 'success', 1200);
    } catch {
      toast(`Failed to copy ${label}`, 'error', 1600);
    }
  }

  function exportJSON(data, filename = 'ffcp-export.json') {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    toast(`Exported ${filename}`, 'success', 1200);
  }

  // -----------------------------
  // ELEMENT PICKER (fixed bindings)
  // -----------------------------
  const ElementPicker = {
    overlay: null,
    _onMouseOver: null,
    _onClick: null,

    init() {
      if (this.overlay) return;
      this.overlay = document.createElement('div');
      this.overlay.id = 'ffcp-picker-overlay';
      document.body.appendChild(this.overlay);
    },
    start() {
      this.init();
      state.elementPickerActive = true;
      updateUIVisibility();
      toast('Element Picker active: hover and click a post', 'info', 4000);
      this.overlay.style.display = 'block';

      // bind once and reuse for removal
      this._onMouseOver = this._onMouseOver || this.handleMouseOver.bind(this);
      this._onClick = this._onClick || this.handleClick.bind(this);

      document.addEventListener('mouseover', this._onMouseOver);
      document.addEventListener('click', this._onClick, true);
    },
    stop() {
      state.elementPickerActive = false;
      updateUIVisibility();
      if (this.overlay) this.overlay.style.display = 'none';
      if (this._onMouseOver) document.removeEventListener('mouseover', this._onMouseOver);
      if (this._onClick) document.removeEventListener('click', this._onClick, true);
    },
    handleMouseOver(e) {
      const rect = e.target.getBoundingClientRect();
      Object.assign(this.overlay.style, {
        top: `${rect.top + window.scrollY}px`,
        left: `${rect.left + window.scrollX}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`
      });
    },
    handleClick(e) {
      e.preventDefault();
      e.stopPropagation();
      const post = e.target.closest(CONFIG.postSelector);
      this.stop();
      if (post) this.analyze(post);
      else toast('No containing post found (role="article")', 'error');
    },
    analyze(post) {
      const actor = findActor(post);
      const menu = anySelector(post, CONFIG.postMenuSelectors);
      const analysis = `
        <h3>Post Analysis</h3>
        <p><strong>Actor Name:</strong> ${actor?.name || 'Not Found'}</p>
        <p><strong>Actor Link:</strong> ${actor?.link || 'Not Found'}</p>
        <p><strong>Menu Button Found:</strong> ${menu ? 'Yes' : 'No'}</p>
        <p><strong>Reason (current rules):</strong> ${classify(post) || 'None'}</p>
        <p><strong>Post Excerpt:</strong></p>
        <textarea readonly>${clip(post.innerText, 600)}</textarea>
        <p>This info helps refine selectors if unfollow fails.</p>
      `;
      showModal(analysis);
    }
  };

  // -----------------------------
  // UI
  // -----------------------------
  function injectStyles() {
    GM_addStyle(`
:root {
  --ffcp-bg: #0f1115;
  --ffcp-bg2: #151823;
  --ffcp-text: #eaeef6;
  --ffcp-dim: #a9b0c0;
  --ffcp-accent: #6aa2ff;
  --ffcp-accent2: #9b6aff;
  --ffcp-danger: #ff5c7a;
  --ffcp-success: #5ad18a;
  --ffcp-border: #222738;
  --ffcp-shadow: 0 8px 30px rgba(0,0,0,.45);
}

#ffcp-drawer, #ffcp-content, #ffcp-header, #ffcp-footer { box-sizing: border-box; max-width: 100%; }

#ffcp-drawer {
  position: fixed; top: 0; right: 0; height: 100dvh; width: min(100vw, 400px);
  background: #10131bF2; color: var(--ffcp-text); z-index: 2147483646;
  display: grid; grid-template-rows: auto auto 1fr auto; transform: translateX(110%);
  transition: transform .22s ease; border-left: 1px solid var(--ffcp-border); box-shadow: var(--ffcp-shadow);
  backdrop-filter: blur(8px);
}
#ffcp-drawer.open { transform: translateX(0); }

#ffcp-header {
  display: grid; grid-template-columns: 1fr auto; align-items: center;
  gap: 10px; padding: 12px 14px; background: var(--ffcp-bg2); border-bottom: 1px solid var(--ffcp-border);
  font-weight: 700;
}
#ffcp-close-btn { background: none; border: 1px solid #3a4464; color: var(--ffcp-text); border-radius: 8px; padding: 6px 10px; cursor: pointer; }

#ffcp-tabs { display: grid; grid-auto-flow: column; gap: 0; background: var(--ffcp-bg2); border-bottom: 1px solid var(--ffcp-border); }
.ffcp-tab-btn { padding: 10px 12px; background: none; border: none; color: var(--ffcp-dim); cursor: pointer; border-bottom: 2px solid transparent; }
.ffcp-tab-btn.active { color: var(--ffcp-accent); border-bottom-color: var(--ffcp-accent); }

#ffcp-content { padding: 14px; overflow: auto; display: grid; gap: 12px; }

.ffcp-section { padding-bottom: 12px; border-bottom: 1px solid var(--ffcp-border); }
.ffcp-section h4 { margin: 0 0 8px 0; color: var(--ffcp-accent); }

#ffcp-drawer label { display: block; margin-bottom: 8px; }
#ffcp-drawer input[type="checkbox"] { margin-right: 8px; }
#ffcp-drawer textarea { width: 100%; background: #131725; color: var(--ffcp-text); border: 1px solid #2a3046; border-radius: 8px; padding: 8px; }

#ffcp-fab {
  position: fixed; bottom: 20px; right: 20px; width: 52px; height: 52px; border-radius: 14px;
  background: linear-gradient(180deg, #2a3350, #21263a); color: var(--ffcp-text);
  display: grid; place-items: center; cursor: pointer; z-index: 2147483646; box-shadow: var(--ffcp-shadow);
}
#ffcp-fab.hidden { opacity: .0; transform: scale(.9); pointer-events: none; }

#ffcp-log-container { max-height: 320px; overflow: auto; background: #0f1115; border: 1px solid var(--ffcp-border); border-radius: 8px; padding: 6px; }
.ffcp-log-entry { border-left: 3px solid var(--ffcp-accent); padding: 6px 8px; margin: 6px 0; font-size: 13px; }
.ffcp-log-entry[data-reason="Sponsored"] { border-left-color: #f7b955; }
.ffcp-log-entry[data-reason="Suggested"] { border-left-color: #9b6aff; }
.ffcp-log-entry[data-reason="Keyword"] { border-left-color: #6aa2ff; }
.ffcp-log-entry p { margin: 0 0 3px 0; }
.ffcp-log-entry small { color: var(--ffcp-dim); }

#ffcp-tools-grid { display: grid; gap: 8px; grid-template-columns: 1fr 1fr; }
.ffcp-btn { border: 1px solid #3a4464; border-radius: 10px; padding: 9px 12px; background: linear-gradient(180deg, #2a3350, #21263a); color: var(--ffcp-text); cursor: pointer; }
.ffcp-btn.primary { border-color: #6aa2ff; }
.ffcp-btn.danger { border-color: #ff5c7a; }

#ffcp-analysis-wrap { max-height: 240px; overflow: auto; background: #0f1115; border: 1px solid var(--ffcp-border); border-radius: 8px; }
#ffcp-analysis { width: 100%; border-collapse: collapse; font-size: 12px; }
#ffcp-analysis th, #ffcp-analysis td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--ffcp-border); vertical-align: top; }
#ffcp-analysis th { color: var(--ffcp-dim); }

#ffcp-toast, .ffcp-toast { pointer-events: none; }
#ffcp-toasts { position: fixed; bottom: 16px; right: 16px; display: grid; gap: 8px; z-index: 2147483646; }
.ffcp-toast { background: #131725F2; border: 1px solid var(--ffcp-border); color: var(--ffcp-text); padding: 10px 12px; border-radius: 10px; box-shadow: var(--ffcp-shadow); opacity: 1; transition: opacity .2s ease, transform .2s ease; }
.ffcp-toast.success { border-left: 3px solid var(--ffcp-success); }
.ffcp-toast.error { border-left: 3px solid var(--ffcp-danger); }
.ffcp-toast.info { border-left: 3px solid var(--ffcp-accent); }
.ffcp-toast.hide { opacity: 0; transform: translateY(6px); }

#ffcp-picker-overlay { position: absolute; background: rgba(106,162,255, .18); border: 1px dashed #6aa2ff; z-index: 2147483646; pointer-events: none; display: none; }

#ffcp-modal { position: fixed; inset: 0; background: rgba(0,0,0,.6); display: flex; align-items: center; justify-content: center; z-index: 2147483646; }
#ffcp-modal-content { background: #11151f; color: var(--ffcp-text); width: min(92vw, 560px); max-height: 80vh; overflow: auto; border: 1px solid var(--ffcp-border); border-radius: 12px; padding: 16px; position: relative; }
#ffcp-modal-content textarea { width: 100%; height: 160px; margin-top: 10px; background: #0f1115; border: 1px solid var(--ffcp-border); color: var(--ffcp-text); border-radius: 8px; }
#ffcp-modal-close { position: absolute; top: 8px; right: 8px; border: 1px solid #3a4464; background: #1a2030; color: var(--ffcp-text); border-radius: 8px; padding: 6px 10px; cursor: pointer; }
    `);
  }

  function createDrawer() {
    const drawer = document.createElement('div');
    drawer.id = 'ffcp-drawer';
    drawer.innerHTML = `
      <div id="ffcp-header">
        <div>FFC Pro v4.2</div>
        <button id="ffcp-close-btn">Close</button>
      </div>
      <div id="ffcp-tabs">
        <button class="ffcp-tab-btn active" data-tab="main">Controls</button>
        <button class="ffcp-tab-btn" data-tab="log">Log</button>
        <button class="ffcp-tab-btn" data-tab="tools">Tools</button>
      </div>
      <div id="ffcp-content">
        <!-- Main Controls -->
        <div id="ffcp-tab-main" class="ffcp-tab-content" style="display:block;">
          <div class="ffcp-section">
            <h4>Core Actions</h4>
            <label><input type="checkbox" data-state="autoUnfollow"> Auto-Unfollow Matches</label>
            <label><input type="checkbox" data-state="dryRun"> Dry Run (collect targets only)</label>
            <label><input type="checkbox" data-state="protectFriends"> Protect Friends from Unfollow</label>
          </div>
          <div class="ffcp-section">
            <h4>Content to Match</h4>
            <label><input type="checkbox" data-state="hideSponsored"> Sponsored</label>
            <label><input type="checkbox" data-state="hideSuggested"> Suggested</label>
            <label for="ffcp-keywords">Keywords (comma-separated)</label>
            <textarea id="ffcp-keywords" rows="2" placeholder="giveaway, raffle, win a"></textarea>
          </div>
          <div class="ffcp-section">
            <h4>Automation & Display</h4>
            <label><input type="checkbox" data-state="autoScroll"> Auto-Scroll Feed</label>
            <label><input type="checkbox" data-state="logPosts"> Enable Logging</label>
            <label><input type="checkbox" data-state="highlightPosts"> Highlight Processed Posts</label>
          </div>
          <div class="ffcp-section">
            <h4>Whitelist</h4>
            <textarea id="ffcp-whitelist" rows="2" placeholder="NASA, SpaceX, John Doe"></textarea>
          </div>
          <div id="ffcp-stats" class="ffcp-section"></div>
        </div>

        <!-- Log -->
        <div id="ffcp-tab-log" class="ffcp-tab-content" style="display:none;">
          <div class="ffcp-section">
            <div style="display:flex; gap:8px;">
              <button class="ffcp-btn" id="ffcp-copy-log">Copy</button>
              <button class="ffcp-btn" id="ffcp-export-log">Export</button>
              <button class="ffcp-btn danger" id="ffcp-clear-log">Clear</button>
            </div>
          </div>
          <div id="ffcp-log-container"></div>
        </div>

        <!-- Tools -->
        <div id="ffcp-tab-tools" class="ffcp-tab-content" style="display:none;">
          <div class="ffcp-section" id="ffcp-tools-grid">
            <button class="ffcp-btn primary" id="ffcp-scan-analysis">Scan Posts</button>
            <button class="ffcp-btn" id="ffcp-copy-analysis">Copy Analysis</button>
            <button class="ffcp-btn" id="ffcp-export-analysis">Export Analysis</button>
            <button class="ffcp-btn" id="ffcp-start-picker">Element Picker</button>
          </div>
          <div class="ffcp-section">
            <h4>Unfollow Batch</h4>
            <div style="display:flex; gap:8px; flex-wrap:wrap;">
              <button class="ffcp-btn" id="ffcp-dryrun-from-scan">Collect Targets (Dry Run)</button>
              <button class="ffcp-btn primary" id="ffcp-exec-unfollow">Execute Unfollow</button>
              <button class="ffcp-btn danger" id="ffcp-clear-targets">Clear Targets</button>
            </div>
            <div style="margin-top:8px;color:var(--ffcp-dim);" id="ffcp-target-counts">0 pending / 0 executed</div>
          </div>
          <div id="ffcp-analysis-wrap">
            <table id="ffcp-analysis">
              <thead><tr><th>Source</th><th>Type</th><th>Friend?</th><th>Excerpt</th></tr></thead>
              <tbody id="ffcp-analysis-tbody"><tr><td colspan="4" style="color:var(--ffcp-dim)">No analysis yet</td></tr></tbody>
            </table>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(drawer);

    // Events
    drawer.addEventListener('change', onSettingChange);
    drawer.addEventListener('click', onDrawerClick);

    return drawer;
  }

  function createFab() {
    const fab = document.createElement('div');
    fab.id = 'ffcp-fab';
    fab.textContent = 'FFC';
    fab.addEventListener('click', () => {
      state.isPanelOpen = !state.isPanelOpen;
      updateUIVisibility();
    });
    document.body.appendChild(fab);
  }

  function updateUIVisibility() {
    const drawer = qs('#ffcp-drawer');
    const fab = qs('#ffcp-fab');
    if (!drawer || !fab) return;

    if (state.elementPickerActive) {
      drawer.classList.remove('open');
      fab.classList.add('hidden');
    } else {
      drawer.classList.toggle('open', state.isPanelOpen);
      fab.classList.toggle('hidden', state.isPanelOpen);
    }
  }

  function onSettingChange(e) {
    if (e.target.type === 'checkbox') {
      const key = e.target.dataset.state;
      if (key in state) {
        state[key] = e.target.checked;
        if (key === 'autoScroll') toggleAutoScroll();
        saveSettings();
      }
    }
    if (e.target.id === 'ffcp-keywords') {
      state.keywordList = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
      saveSettings();
    }
    if (e.target.id === 'ffcp-whitelist') {
      state.whitelist = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
      saveSettings();
    }
  }

  function onDrawerClick(e) {
    const tabBtn = e.target.closest('.ffcp-tab-btn');
    if (tabBtn) {
      const tab = tabBtn.dataset.tab;
      qsa('.ffcp-tab-btn').forEach(b => b.classList.toggle('active', b === tabBtn));
      qsa('.ffcp-tab-content').forEach(c => c.style.display = 'none');
      qs(`#ffcp-tab-${tab}`).style.display = 'block';
      return;
    }

    if (e.target.id === 'ffcp-close-btn') {
      state.isPanelOpen = false; updateUIVisibility(); return;
    }
    if (e.target.id === 'ffcp-copy-log') {
      copyJSON(state.loggedPostsData, 'log'); return;
    }
    if (e.target.id === 'ffcp-export-log') {
      exportJSON(state.loggedPostsData, `ffcp-log-${new Date().toISOString()}.json`); return;
    }
    if (e.target.id === 'ffcp-clear-log') {
      state.loggedPostsData = []; updateLogPanel(); toast('Log cleared', 'info', 1000); return;
    }

    if (e.target.id === 'ffcp-start-picker') { ElementPicker.start(); return; }
    if (e.target.id === 'ffcp-scan-analysis') { runAnalysis(); return; }
    if (e.target.id === 'ffcp-copy-analysis') { copyJSON(state.analysis, 'analysis'); return; }
    if (e.target.id === 'ffcp-export-analysis') { exportJSON(state.analysis, 'ffcp-analysis.json'); return; }

    if (e.target.id === 'ffcp-dryrun-from-scan') { collectTargetsFromAnalysis(); return; }
    if (e.target.id === 'ffcp-exec-unfollow') { executeUnfollowBatch(); return; }
    if (e.target.id === 'ffcp-clear-targets') { state.pendingTargets = []; state.executedTargets = []; updateUnfollowCounts(); toast('Targets cleared', 'info', 1000); return; }
  }

  function updateLogPanel() {
    const container = qs('#ffcp-log-container');
    if (!container) return;
    if (!state.logPosts) { container.innerHTML = '<div style="color:var(--ffcp-dim)">Logging disabled</div>'; return; }
    container.innerHTML = state.loggedPostsData.map(log => `
      <div class="ffcp-log-entry" data-reason="${(log.reason || '').split(' ')[0]}">
        <p><strong>${log.reason}</strong> — ${escapeHtml(log.actorName)}</p>
        <small>${escapeHtml(log.ts)} — ${escapeHtml(log.excerpt)}</small>
      </div>
    `).join('');
  }

  function escapeHtml(s) {
    return (s || '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[m]));
  }

  function updateStats() {
    const el = qs('#ffcp-stats');
    if (!el) return;
    el.innerHTML = `
      <h4>Session Stats</h4>
      <p>Processed: ${state.stats.processed} | Unfollowed: ${state.stats.unfollowed}</p>
      <p>Hidden: ${state.stats.hidden} | Friends Protected: ${state.stats.protected}</p>
      <p>Errors: ${state.stats.errors}</p>
    `;
  }

  function updateUnfollowCounts() {
    const el = qs('#ffcp-target-counts');
    if (!el) return;
    el.textContent = `${state.pendingTargets.length} pending / ${state.executedTargets.length} executed`;
  }

  // -----------------------------
  // ANALYSIS & TARGET COLLECTION
  // -----------------------------
  function runAnalysis() {
    const feeds = qsa(CONFIG.feedSelector);
    const rows = [];
    for (const feed of feeds) {
      const posts = qsa(CONFIG.postSelector, feed);
      for (const post of posts) {
        const reason = classify(post);
        const actor = findActor(post);
        rows.push({
          source: { name: actor?.name || '', link: actor?.link || '', isFriend: !!actor?.isFriend },
          reason: reason || 'None',
          excerpt: clip(post.innerText, 260)
        });
      }
    }
    state.analysis = rows;
    renderAnalysisTable();
    toast(`Analyzed ${rows.length} posts`, 'success', 1200);
  }

  function renderAnalysisTable() {
    const tbody = qs('#ffcp-analysis-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (!state.analysis.length) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td colspan="4" style="color:var(--ffcp-dim)">No analysis yet</td>`;
      tbody.appendChild(tr);
      return;
    }
    for (const row of state.analysis.slice(0, 60)) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(row.source.name || '(unknown)')}</td>
        <td>${escapeHtml(row.reason)}</td>
        <td>${row.source.isFriend ? 'Yes' : 'No'}</td>
        <td>${escapeHtml(row.excerpt)}</td>
      `;
      tbody.appendChild(tr);
    }
  }

  function collectTargetsFromAnalysis() {
    state.pendingTargets = [];
    const seen = new Set();
    for (const row of state.analysis) {
      const name = row.source.name;
      if (!name || seen.has(name)) continue;
      seen.add(name);
      if (state.whitelist.includes(name)) continue;
      if (state.protectFriends && row.source.isFriend) continue;
      if (!row.source.link) continue;
      state.pendingTargets.push({ source: row.source, reason: row.reason, dryRun: true });
    }
    updateUnfollowCounts();
    toast(`Collected ${state.pendingTargets.length} targets (dry-run)`, 'info', 1400);
  }

  async function executeUnfollowBatch() {
    if (!state.pendingTargets.length) { toast('No pending targets. Run Scan + Collect first.', 'info', 1600); return; }
    if (state.dryRun) { toast('Disable Dry Run to execute unfollow', 'error', 1600); return; }

    let processed = 0;
    // For each target, try to find a visible post from the same source and run unfollow
    const feeds = qsa(CONFIG.feedSelector);
    for (const target of state.pendingTargets.slice()) {
      let foundPost = null;
      outer: for (const feed of feeds) {
        for (const post of qsa(CONFIG.postSelector, feed)) {
          const a = findActor(post);
          if (a?.name && a.name === target.source.name) { foundPost = post; break outer; }
        }
      }
      if (!foundPost) {
        state.executedTargets.push({ ...target, success: false, error: 'No matching post found on screen' });
        continue;
      }
      await unfollowSourceOfPost(foundPost, target.reason, target.source);
      processed++;
      await sleep(220);
    }
    state.pendingTargets = [];
    updateUnfollowCounts();
    toast(`Executed unfollow on ${processed} targets`, 'success', 1500);
  }

  // -----------------------------
  // MODAL
  // -----------------------------
  function showModal(contentHtml) {
    let modal = qs('#ffcp-modal');
    if (modal) modal.remove();
    modal = document.createElement('div');
    modal.id = 'ffcp-modal';
    modal.innerHTML = `
      <div id="ffcp-modal-content">
        <button id="ffcp-modal-close">Close</button>
        ${contentHtml}
      </div>
    `;
    document.body.appendChild(modal);
    qs('#ffcp-modal-close').addEventListener('click', () => modal.remove());
  }

  // -----------------------------
  // PERSISTENCE & AUTOSCROLL
  // -----------------------------
  function saveSettings() {
    const s = {
      autoUnfollow: state.autoUnfollow,
      dryRun: state.dryRun,
      protectFriends: state.protectFriends,
      hideSponsored: state.hideSponsored,
      hideSuggested: state.hideSuggested,
      keywordList: state.keywordList,
      autoScroll: state.autoScroll,
      logPosts: state.logPosts,
      highlightPosts: state.highlightPosts,
      whitelist: state.whitelist
    };
    GM_setValue('ffcp_settings_v42', JSON.stringify(s));
  }

  function loadSettings() {
    const saved = GM_getValue('ffcp_settings_v42', null);
    if (saved) {
      try { Object.assign(state, JSON.parse(saved)); } catch {}
    }
    // update controls
    qsa('#ffcp-drawer input[type="checkbox"]').forEach(cb => {
      const key = cb.dataset.state;
      if (key in state) cb.checked = !!state[key];
    });
    const kw = qs('#ffcp-keywords');
    if (kw) kw.value = state.keywordList.join(', ');
    const wl = qs('#ffcp-whitelist');
    if (wl) wl.value = state.whitelist.join(', ');
  }

  function toggleAutoScroll() {
    if (state.autoScroll) {
      clearInterval(state.scrollTimer);
      state.scrollTimer = setInterval(() => window.scrollBy(0, CONFIG.scrollAmount), CONFIG.scrollInterval);
    } else {
      clearInterval(state.scrollTimer);
      state.scrollTimer = null;
    }
  }

  // -----------------------------
  // INIT
  // -----------------------------
  function init() {
    injectStyles();
    createDrawer();
    createFab();
    loadSettings();
    updateUIVisibility();
    updateStats();
    toggleAutoScroll();

    // Wait for feed, then start scanning and observe mutations
    const waitFeed = new MutationObserver((_, obs) => {
      const feed = qs(CONFIG.feedSelector);
      if (feed) {
        obs.disconnect();
        // Interval scanner as safety
        setInterval(scanFeed, CONFIG.scanInterval);
        // Observe feed mutations
        state.feedObserver = new MutationObserver(scanFeed);
        qsa(CONFIG.feedSelector).forEach(f => state.feedObserver.observe(f, { childList: true, subtree: true }));
      }
    });
    waitFeed.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
