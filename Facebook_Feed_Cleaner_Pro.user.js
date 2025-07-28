// ==UserScript==
// @name         Facebook Feed Cleaner Pro
// @namespace    https://github.com/SysAdminDoc/Facebook-Feed-Cleaner-Pro/
// @version      2.0
// @description  A professional and versatile tool to declutter your Facebook feed by hiding sponsored posts, suggestions, reels, videos, shared content, and keyword-based posts.
// @author       Matthew Parker
// @match        https://www.facebook.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // --- CONFIGURATION & STATE ---

    const CONFIG = {
        // Selectors for identifying key elements. These are based on current Facebook structure
        // and may need updates if Facebook changes its layout significantly.
        feedSelector: 'div[role="feed"]',
        postSelector: 'div[data-ad-preview="message"], div[data-ad-id], div[aria-labelledby][class*=" "]:not([class*="fb"])',
        sponsoredSelector: 'a[href*="/ads/about/"]',
        suggestedSelector: 'span[dir="auto"]:first-child', // This is fragile, needs text matching
        sharedPostIndicator: 'a[href*="/shares/"]',
        reelIndicator: 'a[href*="/reel/"]',
        videoIndicator: 'a[href*="/videos/"]',

        // Performance settings
        scanInterval: 750, // ms between scanning for new posts
        processedAttribute: 'data-ffc-processed', // Attribute to mark processed posts

        // UI settings
        uiToggleKey: 'KeyF', // Press 'F' with Ctrl+Shift to toggle the UI
    };

    let state = {
        postsHidden: 0,
        filters: {},
        keywords: [],
        isUIVisible: true
    };

    // --- CORE FUNCTIONALITY ---

    /**
     * Loads settings from storage or sets defaults.
     */
    function loadSettings() {
        state.filters = GM_getValue('filters', {
            sponsored: true,
            suggested: true,
            reels: true,
            videos: false,
            shared: false,
            keywords: true
        });
        state.keywords = GM_getValue('keywords', ['giveaway', 'raffle', 'win a']);
        state.isUIVisible = GM_getValue('isUIVisible', true);
    }

    /**
     * Checks a post against active filters and hides it if it matches.
     * @param {HTMLElement} post - The post element to check.
     */
    function processPost(post) {
        if (post.hasAttribute(CONFIG.processedAttribute)) {
            return;
        }
        post.setAttribute(CONFIG.processedAttribute, 'true');

        let reason = null;

        // Check against each filter type
        if (state.filters.sponsored && isSponsored(post)) reason = 'Sponsored';
        else if (state.filters.suggested && isSuggested(post)) reason = 'Suggested';
        else if (state.filters.reels && isReel(post)) reason = 'Reel';
        else if (state.filters.videos && isVideo(post)) reason = 'Video';
        else if (state.filters.shared && isShared(post)) reason = 'Shared Content';
        else if (state.filters.keywords && matchesKeyword(post)) reason = 'Keyword Match';

        if (reason) {
            hidePost(post, reason);
        }
    }

    /**
     * Hides the post and adds a small debug message (optional).
     * @param {HTMLElement} post - The post element to hide.
     * @param {string} reason - The reason for hiding the post.
     */
    function hidePost(post, reason) {
        post.style.display = 'none';
        state.postsHidden++;
        console.log(`[FFC] Hid post: ${reason}. Total hidden: ${state.postsHidden}`);
        updateStats();
    }

    // --- DETECTION LOGIC ---

    const isSponsored = (post) => post.querySelector(CONFIG.sponsoredSelector);
    const isSuggested = (post) => {
        const span = post.querySelector(CONFIG.suggestedSelector);
        return span && span.textContent.includes('Suggested for you');
    };
    const isReel = (post) => post.querySelector(CONFIG.reelIndicator);
    const isVideo = (post) => post.querySelector(CONFIG.videoIndicator) && !isReel(post); // Don't hide reels if only videos are selected
    const isShared = (post) => post.querySelector(CONFIG.sharedPostIndicator);
    const matchesKeyword = (post) => {
        const textContent = post.textContent.toLowerCase();
        return state.keywords.some(keyword => textContent.includes(keyword.toLowerCase()));
    };

    /**
     * Main loop to find and process new posts in the feed.
     */
    function scanFeed() {
        const feed = document.querySelector(CONFIG.feedSelector);
        if (!feed) return; // Feed not on page

        const posts = feed.querySelectorAll(CONFIG.postSelector);
        posts.forEach(processPost);
    }

    // --- USER INTERFACE ---

    /**
     * Injects CSS for the control panel.
     */
    function addStyles() {
        GM_addStyle(`
            #ffc-panel {
                position: fixed;
                top: 80px;
                right: 15px;
                z-index: 9999;
                background-color: #ffffff;
                border: 1px solid #ddd;
                border-radius: 8px;
                box-shadow: 0 2px 8px rgba(0,0,0,0.15);
                padding: 12px;
                width: 240px;
                font-family: Arial, sans-serif;
                font-size: 14px;
                transition: transform 0.3s ease-in-out;
            }
            #ffc-panel.hidden {
                transform: translateX(110%);
            }
            #ffc-panel h3 {
                margin: 0 0 10px 0;
                font-size: 16px;
                color: #1877f2;
                text-align: center;
            }
            #ffc-panel .ffc-toggle {
                display: flex;
                align-items: center;
                justify-content: space-between;
                margin-bottom: 8px;
            }
            #ffc-panel .ffc-toggle label {
                cursor: pointer;
            }
            #ffc-panel .ffc-toggle input {
                cursor: pointer;
            }
            #ffc-panel #ffc-keywords {
                width: 100%;
                box-sizing: border-box;
                padding: 5px;
                border: 1px solid #ccc;
                border-radius: 4px;
                margin-top: 5px;
                resize: vertical;
            }
            #ffc-panel #ffc-stats {
                margin-top: 10px;
                padding-top: 10px;
                border-top: 1px solid #eee;
                font-size: 12px;
                color: #555;
            }
            #ffc-panel #ffc-save-keywords {
                width: 100%;
                padding: 8px;
                background-color: #1877f2;
                color: white;
                border: none;
                border-radius: 4px;
                cursor: pointer;
                margin-top: 5px;
            }
            #ffc-panel #ffc-save-keywords:hover {
                background-color: #166fe5;
            }
            #ffc-panel #ffc-panel-toggle-btn {
                position: fixed;
                top: 80px;
                right: 15px;
                z-index: 10000;
                background: #1877f2;
                color: white;
                border: none;
                border-radius: 8px 0 0 8px;
                padding: 10px;
                cursor: pointer;
                box-shadow: -2px 2px 8px rgba(0,0,0,0.15);
                transform: translateX(0);
                transition: transform 0.3s ease-in-out;
            }
            #ffc-panel #ffc-panel-toggle-btn.hidden {
                transform: translateX(-265px); /* panel width + padding */
            }
        `);
    }

    /**
     * Creates the HTML for the control panel.
     */
    function createUI() {
        const panel = document.createElement('div');
        panel.id = 'ffc-panel';
        document.body.appendChild(panel);

        const toggleButton = document.createElement('button');
        toggleButton.id = 'ffc-panel-toggle-btn';
        toggleButton.innerHTML = '⚙️';
        document.body.appendChild(toggleButton);

        panel.innerHTML = `
            <h3>Feed Cleaner Pro</h3>
            <div id="ffc-filters"></div>
            <hr>
            <div>
                <label for="ffc-keywords"><strong>Blocked Keywords</strong> (comma separated)</label>
                <textarea id="ffc-keywords" rows="3"></textarea>
                <button id="ffc-save-keywords">Save Keywords</button>
            </div>
            <div id="ffc-stats">
                <p><strong>Posts Hidden This Session:</strong> <span id="ffc-hidden-count">0</span></p>
                <p style="font-size: 11px; color: #888;">Toggle UI with Ctrl+Shift+${CONFIG.uiToggleKey}</p>
            </div>
        `;

        // Create toggles
        const filtersContainer = panel.querySelector('#ffc-filters');
        for (const key in state.filters) {
            const div = document.createElement('div');
            div.className = 'ffc-toggle';
            const label = document.createElement('label');
            label.htmlFor = `ffc-toggle-${key}`;
            label.textContent = `Hide ${key.charAt(0).toUpperCase() + key.slice(1)}`;

            const input = document.createElement('input');
            input.type = 'checkbox';
            input.id = `ffc-toggle-${key}`;
            input.checked = state.filters[key];
            input.dataset.filter = key;

            div.appendChild(label);
            div.appendChild(input);
            filtersContainer.appendChild(div);
        }

        // Populate keywords
        panel.querySelector('#ffc-keywords').value = state.keywords.join(', ');

        // Add event listeners
        panel.addEventListener('change', handleUIChange);
        panel.querySelector('#ffc-save-keywords').addEventListener('click', saveKeywords);
        toggleButton.addEventListener('click', toggleUIVisibility);

        // Set initial visibility
        if (!state.isUIVisible) {
            panel.classList.add('hidden');
            toggleButton.classList.add('hidden');
        }
    }

    /**
     * Handles changes in the UI (toggles).
     * @param {Event} e - The change event.
     */
    function handleUIChange(e) {
        if (e.target.type === 'checkbox') {
            const filter = e.target.dataset.filter;
            if (filter) {
                state.filters[filter] = e.target.checked;
                GM_setValue('filters', state.filters);
                console.log(`[FFC] Set filter '${filter}' to ${state.filters[filter]}`);
            }
        }
    }

    /**
     * Saves the keywords from the textarea to storage.
     */
    function saveKeywords() {
        const keywordsText = document.getElementById('ffc-keywords').value;
        state.keywords = keywordsText.split(',').map(k => k.trim()).filter(Boolean);
        GM_setValue('keywords', state.keywords);
        alert('Keywords saved!');
    }

    /**
     * Updates the hidden posts counter in the UI.
     */
    function updateStats() {
        const countEl = document.getElementById('ffc-hidden-count');
        if (countEl) {
            countEl.textContent = state.postsHidden;
        }
    }

    function toggleUIVisibility() {
        state.isUIVisible = !state.isUIVisible;
        GM_setValue('isUIVisible', state.isUIVisible);
        document.getElementById('ffc-panel').classList.toggle('hidden');
        document.getElementById('ffc-panel-toggle-btn').classList.toggle('hidden');
    }

    /**
     * Listens for keyboard shortcuts.
     * @param {KeyboardEvent} e - The keydown event.
     */
    function handleKeyPress(e) {
        if (e.ctrlKey && e.shiftKey && e.code === CONFIG.uiToggleKey) {
            toggleUIVisibility();
        }
    }

    // --- INITIALIZATION ---

    function init() {
        console.log('[FFC] Initializing Facebook Feed Cleaner Pro v2.0');
        loadSettings();
        addStyles();
        createUI();
        setInterval(scanFeed, CONFIG.scanInterval);
        document.addEventListener('keydown', handleKeyPress);
    }

    // Wait for the feed to be available before initializing
    const initObserver = new MutationObserver((mutations, obs) => {
        if (document.querySelector(CONFIG.feedSelector)) {
            obs.disconnect(); // Stop observing once the feed is found
            init();
        }
    });

    initObserver.observe(document.body, {
        childList: true,
        subtree: true
    });

})();
