// ==UserScript==
// @name         RES for Old Reddit
// @namespace    https://github.com/SysAdminDoc/Reddit_Enhancement_Suite_2.0
// @version      2.8
// @description  Automatically redirects to Old Reddit, plus a retractable sidebar, themes, and other enhancements.
// @author       Matthew Parker
// @match        https://old.reddit.com/*
// @match        https://www.reddit.com/*
// @exclude      *://www.reddit.com/poll/*
// @icon         https://b.thumbs.redditmedia.com/JeP1WF0kEiiH1gT8vOr_7kFAwIlHzRBHjLDZIkQP61Q.jpg
// @resource     DARK_THEME https://github.com/SysAdminDoc/Reddit_Enhancement_Suite_2.0/raw/refs/heads/main/themes/darkmode.css
// @resource     CATPPUCCIN_THEME https://raw.githubusercontent.com/SysAdminDoc/Reddit_Enhancement_Suite_2.0/refs/heads/main/themes/catppuccin-mocha.css
// @resource     CLEAN_THEME https://raw.githubusercontent.com/SysAdminDoc/Reddit_Enhancement_Suite_2.0/refs/heads/main/themes/cleanskinrestlye.css
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_getResourceText
// @run-at       document-start
// @downloadURL  https://github.com/SysAdminDoc/Reddit_Enhancement_Suite_2.0/raw/refs/heads/main/RES%20for%20Old%20Reddit.user.js
// @updateURL    https://github.com/SysAdminDoc/Reddit_Enhancement_Suite_2.0/raw/refs/heads/main/RES%20for%20Old%20Reddit.user.js
// ==/UserScript==

(function() {
    'use strict';

    // --- NEW FEATURE: BRING BACK OLD REDDIT ---
    // This function checks if the user is on new Reddit and redirects them to old.reddit.com if the setting is enabled.
    // It runs at document-start to prevent the new Reddit interface from loading.
    function bringBackOldReddit() {
        // The setting is enabled by default.
        const isEnabled = GM_getValue('res_force_old_reddit_enabled', true);
        if (isEnabled && window.location.hostname === 'www.reddit.com') {
            window.location.replace("https://old.reddit.com" + window.location.pathname + window.location.search);
            return true; // Indicate that a redirect is happening
        }
        return false; // Indicate no redirect
    }

    // Execute the redirect immediately. If it happens, stop the rest of the script.
    if (bringBackOldReddit()) {
        return;
    }

    // --- 1. CONFIGURATION & CONSTANTS ---
    const OLD_FAVICON_URL = 'https://b.thumbs.redditmedia.com/JeP1WF0kEiiH1gT8vOr_7kFAwIlHzRBHjLDZIkQP61Q.jpg';
    let originalFavicon = null;
    let cssObserver = null;
    let commentsObserver = null;
    let dynamicStyleTag = null;
    let previewInterval = null;

    // --- 2. UI & STYLE INJECTION ---

    function injectBaseStyles() {
        GM_addStyle(`
            /* --- Settings Cog & Modal --- */
            .res-settings-cog { font-size: 20px; cursor: pointer; margin-left: 8px; line-height: 1; font-weight: bold; color: var(--text-normal, #369); text-decoration: none !important; }
            .res-settings-cog:hover { color: var(--text-normal-hover, #4ac); }
            .res-modal-overlay { display: none; position: fixed; z-index: 1001; left: 0; top: 0; width: 100%; height: 100%; background-color: rgba(0,0,0,0.6); backdrop-filter: blur(4px); transition: background-color 0.3s, backdrop-filter 0.3s; }
            .res-modal-content { position: relative; background-color: #f4f4f4; margin: 5% auto; padding: 20px; border: 1px solid #888; border-radius: 8px; width: 90%; max-width: 600px; color: #111; transition: background-color 0.3s, opacity 0.3s; max-height: 85vh; overflow-y: auto; }
            .res-modal-header { padding-bottom: 10px; border-bottom: 1px solid #ccc; font-size: 1.5em; margin-bottom: 20px; transition: opacity 0.3s; }
            .res-modal-close { color: #aaa; float: right; font-size: 28px; font-weight: bold; cursor: pointer; transition: opacity 0.3s; }

            /* --- Theme Preview States --- */
            .res-modal-overlay.theme-preview-active { background-color: transparent !important; backdrop-filter: none !important; }
            .res-modal-overlay.theme-preview-active .res-modal-content { opacity: 0.15; }
            #res-theme-countdown {
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background: rgba(255, 255, 255, 0.4);
                color: #111;
                padding: 20px 40px;
                border-radius: 10px;
                font-size: 1.2em;
                font-weight: bold;
                z-index: 1002;
                text-align: center;
                backdrop-filter: blur(5px);
                -webkit-backdrop-filter: blur(5px);
                box-shadow: 0 4px 20px rgba(0,0,0,0.2);
                border: 1px solid rgba(255,255,255,0.2);
            }

            /* --- Collapsible Setting Groups --- */
            .res-setting-group { margin-bottom: 10px; border: 1px solid #ddd; border-radius: 5px; transition: opacity 0.3s, background-color 0.3s; }
            .res-group-header { cursor: pointer; padding: 10px 15px; display: flex; justify-content: space-between; align-items: center; }
            .res-group-header h3 { margin: 0; font-size: 1.2em; }
            .res-group-header .res-chevron { transition: transform 0.3s; }
            .res-group-content { max-height: 0; overflow: hidden; transition: max-height 0.4s ease-out, padding 0.4s ease-out; padding: 0 15px; }
            .res-setting-group:not(.collapsed) .res-group-content { max-height: 1000px; /* Large enough for content */ padding: 15px; }
            .res-setting-group:not(.collapsed) .res-chevron { transform: rotate(90deg); }

            .res-setting-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; padding-bottom: 10px; border-bottom: 1px solid #eee; }
            .res-setting-row:last-child { margin-bottom: 0; padding-bottom: 0; border-bottom: none; }
            .res-setting-row label { flex-basis: 60%; }
            .res-setting-row .res-control { flex-basis: 40%; display: flex; justify-content: flex-end; align-items: center; gap: 10px; }
            .res-setting-row .res-control input[type="range"] { width: 120px; }
            .res-setting-row .res-control .res-range-value { min-width: 40px; text-align: right; font-family: monospace; }
            .res-setting-row .res-control select { padding: 5px; border-radius: 4px; border: 1px solid #ccc; }

            /* --- Dark Mode & Live Preview Styles --- */
            html.res-is-dark .res-modal-content { background-color: var(--gray-1, #232323); color: var(--text-normal, #eee); border-color: var(--gray-3, #454545); }
            html.res-is-dark .res-modal-header, html.res-is-dark .res-setting-group { border-color: var(--gray-3, #454545); }
            html.res-is-dark .res-setting-row { border-bottom-color: #444; }
            html.res-is-dark .res-control select { background-color: #333; color: #eee; border-color: #555; }
            .res-modal-overlay.live-preview-active { background-color: rgba(0,0,0,0.1); backdrop-filter: none; }
            .res-modal-overlay.live-preview-active .res-modal-content { background-color: transparent; border: none; box-shadow: none; }
            .res-modal-overlay.live-preview-active .res-setting-group:not(.active-slider-group),
            .res-modal-overlay.live-preview-active .res-modal-header,
            .res-modal-overlay.live-preview-active .res-modal-close { opacity: 0; pointer-events: none; }
            .res-modal-overlay.live-preview-active .res-setting-group.active-slider-group { opacity: 1; background: rgba(255, 255, 255, 0.9); border-radius: 8px; padding-top: 0; box-shadow: 0 0 20px rgba(0,0,0,0.5); }
            html.res-is-dark .res-modal-overlay.live-preview-active .res-setting-group.active-slider-group { background: rgba(50, 50, 50, 0.9); }

            /* --- Custom Scrollbar --- */
            .res-modal-content::-webkit-scrollbar { width: 8px; }
            .res-modal-content::-webkit-scrollbar-track { background: #f1f1f1; border-radius: 10px; }
            .res-modal-content::-webkit-scrollbar-thumb { background: #888; border-radius: 10px; }
            .res-modal-content::-webkit-scrollbar-thumb:hover { background: #555; }
            html.res-is-dark .res-modal-content::-webkit-scrollbar-track { background: #333; }
            html.res-is-dark .res-modal-content::-webkit-scrollbar-thumb { background: #666; }
            html.res-is-dark .res-modal-content::-webkit-scrollbar-thumb:hover { background: #888; }

            /* --- Multireddit Dark Theme --- */
            html.res-is-dark .listing-chooser {
                background: #1a1a1a !important;
                border: 1px solid #333 !important;
            }
            html.res-is-dark .listing-chooser .title,
            html.res-is-dark .listing-chooser li a {
                color: #ddd !important;
            }
            html.res-is-dark .listing-chooser .grippy {
                border-color: #333 !important;
            }
        `);
    }

    function createSettingsPanel() {
        // This function can only run on a page with the correct DOM, so it will only run on old.reddit.com
        const headerRight = document.getElementById('header-bottom-right');
        if (headerRight) {
            const settingsCog = document.createElement('a');
            settingsCog.href = 'javascript:void(0)';
            settingsCog.className = 'res-settings-cog';
            settingsCog.innerHTML = '⚙️';
            settingsCog.title = 'RES for Old Reddit Settings';
            headerRight.appendChild(settingsCog);
            settingsCog.addEventListener('click', () => document.getElementById('res-modal-overlay').style.display = 'block');
        }

        const modalHTML = `
            <div id="res-modal-overlay" class="res-modal-overlay">
                <div class="res-modal-content">
                    <span id="res-modal-close" class="res-modal-close">&times;</span>
                    <div class="res-modal-header">RES for Old Reddit Settings</div>

                    <div class="res-setting-group" data-group-id="general">
                        <div class="res-group-header"><h3>General</h3><span class="res-chevron">▸</span></div>
                        <div class="res-group-content">
                             <div class="res-setting-row">
                                <label for="res-setting-force-old-reddit">Always Use Old Reddit<br><small>Redirects www.reddit.com to old.reddit.com</small></label>
                                <div class="res-control"><input type="checkbox" id="res-setting-force-old-reddit"></div>
                            </div>
                        </div>
                    </div>
                    <div class="res-setting-group" data-group-id="appearance">
                        <div class="res-group-header"><h3>Appearance</h3><span class="res-chevron">▸</span></div>
                        <div class="res-group-content">
                             <div class="res-setting-row">
                                <label for="res-setting-theme">Theme</label>
                                <div class="res-control">
                                    <select id="res-setting-theme">
                                        <option value="none">None (Default Reddit)</option>
                                        <option value="dark">Default Dark Mode</option>
                                        <option value="catppuccin">Catppuccin Mocha</option>
                                        <option value="clean_light">Clean Restyle (Light)</option>
                                        <option value="clean_dark">Clean Restyle (Dark)</option>
                                    </select>
                                </div>
                            </div>
                            <div class="res-setting-row"> <label for="res-setting-no-css">Disable Subreddit CSS</label> <div class="res-control"><input type="checkbox" id="res-setting-no-css"></div> </div>
                            <div class="res-setting-row"> <label for="res-setting-old-favicon">Use Classic Favicon</label> <div class="res-control"><input type="checkbox" id="res-setting-old-favicon"></div> </div>
                        </div>
                    </div>

                    <div class="res-setting-group" data-group-id="sidebar">
                        <div class="res-group-header"><h3>Sidebar</h3><span class="res-chevron">▸</span></div>
                        <div class="res-group-content">
                            <div class="res-setting-row"> <label for="res-setting-sidebar">Enable Retractable Sidebar</label> <div class="res-control"><input type="checkbox" id="res-setting-sidebar"></div> </div>
                            <div class="res-setting-row"> <label for="res-setting-sidebar-float">Float over content (no push)</label> <div class="res-control"><input type="checkbox" id="res-setting-sidebar-float"></div> </div>
                            <div class="res-setting-row"> <label>Sidebar Position</label> <div class="res-control res-radio-group"> <input type="radio" id="res-sidebar-pos-left" name="sidebar_pos" value="left"><label for="res-sidebar-pos-left">Left</label> <input type="radio" id="res-sidebar-pos-right" name="sidebar_pos" value="right"><label for="res-sidebar-pos-right">Right</label> </div> </div>
                            <div class="res-setting-row"> <label for="res-setting-sidebar-width">Sidebar Width</label> <div class="res-control"> <input type="range" id="res-setting-sidebar-width" min="250" max="500" step="5"> <span class="res-range-value" id="res-sidebar-width-value"></span> </div> </div>
                            <div class="res-setting-row"> <label for="res-setting-handle-width">Handle Width</label> <div class="res-control"> <input type="range" id="res-setting-handle-width" min="15" max="50" step="1"> <span class="res-range-value" id="res-handle-width-value"></span> </div> </div>
                            <div class="res-setting-row"> <label for="res-setting-swap-sidebar">Swap with Multireddit Panel<br><small>(when sidebar is on left)</small></label> <div class="res-control"><input type="checkbox" id="res-setting-swap-sidebar"></div> </div>
                        </div>
                    </div>

                    <div class="res-setting-group" data-group-id="comments">
                        <div class="res-group-header"><h3>Comments & Posts</h3><span class="res-chevron">▸</span></div>
                        <div class="res-group-content">
                            <div class="res-setting-row"> <label for="res-setting-hide-comments">Auto Hide Child Comments</label> <div class="res-control"><input type="checkbox" id="res-setting-hide-comments"></div> </div>
                            <div class="res-setting-row"> <label for="res-setting-hide-deleted">Hide Deleted/Removed Comments</label> <div class="res-control"><input type="checkbox" id="res-setting-hide-deleted"></div> </div>
                            <div class="res-setting-row"> <label for="res-setting-comment-width">Max Comment Width</label> <div class="res-control"> <input type="range" id="res-setting-comment-width" min="700" max="1200" step="10"> <span class="res-range-value" id="res-comment-width-value"></span> </div> </div>
                        </div>
                    </div>

                    <div class="res-setting-group" data-group-id="nags">
                        <div class="res-group-header"><h3>Hide Premium Nags</h3><span class="res-chevron">▸</span></div>
                        <div class="res-group-content">
                            <div class="res-setting-row"> <label for="res-setting-hide-premium">Hide Sidebar Premium Banner</label> <div class="res-control"><input type="checkbox" id="res-setting-hide-premium"></div> </div>
                            <div class="res-setting-row"> <label for="res-setting-hide-new-reddit">Hide "Get New Reddit" Button</label> <div class="res-control"><input type="checkbox" id="res-setting-hide-new-reddit"></div> </div>
                            <div class="res-setting-row"> <label for="res-setting-hide-multireddit">Hide Multireddit Panel</label> <div class="res-control"><input type="checkbox" id="res-setting-hide-multireddit"></div> </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHTML);
        addSettingsEventListeners();
    }

    function addSettingsEventListeners() {
        document.getElementById('res-modal-close').addEventListener('click', () => {
            sessionStorage.removeItem('res-settings-open');
            document.getElementById('res-modal-overlay').style.display = 'none';
        });
        document.getElementById('res-modal-overlay').addEventListener('click', (e) => {
            if (e.target.id === 'res-modal-overlay') {
                sessionStorage.removeItem('res-settings-open');
                e.target.style.display = 'none';
            }
        });

        document.querySelectorAll('.res-group-header').forEach(header => {
            header.addEventListener('click', () => {
                const group = header.closest('.res-setting-group');
                const groupId = group.dataset.groupId;
                const isCollapsed = group.classList.toggle('collapsed');
                GM_setValue(`res_group_${groupId}_collapsed`, isCollapsed);
            });
        });

        document.getElementById('res-setting-theme').addEventListener('change', (e) => {
            GM_setValue('res_theme', e.target.value);
            resetTheme();
            sessionStorage.setItem('res-settings-open', 'true');
            sessionStorage.setItem('res-theme-preview', 'true');
            window.location.reload();
        });

        const checkboxes = {
            /* MODIFICATION START: New checkbox for redirect */
            'res-setting-force-old-reddit': 'res_force_old_reddit_enabled',
            /* MODIFICATION END */
            'res-setting-sidebar': 'res_sidebar_enabled', 'res-setting-sidebar-float': 'res_sidebar_float',
            'res-setting-no-css': 'res_no_css_enabled',
            'res-setting-hide-comments': 'res_hide_comments_enabled', 'res-setting-hide-deleted': 'res_hide_deleted_enabled',
            'res-setting-old-favicon': 'res_old_favicon_enabled',
            'res-setting-hide-premium': 'res_hide_premium_banner',
            'res-setting-hide-new-reddit': 'res_hide_get_new_reddit_btn',
            'res-setting-hide-multireddit': 'res_hide_multireddit_panel',
            'res-setting-swap-sidebar': 'res_swap_sidebar_enabled'
        };
        for (const id in checkboxes) {
            document.getElementById(id).addEventListener('change', (e) => {
                GM_setValue(checkboxes[id], e.target.checked);
                if (id === 'res-setting-no-css' || id === 'res-setting-force-old-reddit') {
                    // Changing redirect or CSS requires a reload to see changes
                    sessionStorage.setItem('res-settings-open', 'true');
                    window.location.reload();
                } else {
                    applySettings();
                }
            });
        }

        document.querySelectorAll('input[name="sidebar_pos"]').forEach(radio => {
            radio.addEventListener('change', () => {
                GM_setValue('res_sidebar_position', radio.value);
                sessionStorage.setItem('res-settings-open', 'true');
                window.location.reload();
            });
        });

        const sliders = {
            'res-setting-sidebar-width': { key: 'res_sidebar_width', isSidebar: true },
            'res-setting-handle-width': { key: 'res_handle_width', isSidebar: true },
            'res-setting-comment-width': { key: 'res_comment_width', isSidebar: false }
        };
        const modalOverlay = document.getElementById('res-modal-overlay');
        let wasSidebarLocked;

        for (const id in sliders) {
            const slider = document.getElementById(id);
            const settingGroup = slider.closest('.res-setting-group');

            slider.addEventListener('input', applyDynamicStyles);
            slider.addEventListener('change', () => GM_setValue(sliders[id].key, slider.value));

            const startPreview = () => {
                modalOverlay.classList.add('live-preview-active');
                if (settingGroup) settingGroup.classList.add('active-slider-group');
                if (sliders[id].isSidebar) {
                    wasSidebarLocked = document.body.classList.contains('res-sidebar-locked');
                    if (!wasSidebarLocked) {
                        document.body.classList.add('res-sidebar-locked');
                        applyDynamicStyles();
                    }
                }
            };
            const endPreview = () => {
                modalOverlay.classList.remove('live-preview-active');
                if (settingGroup) settingGroup.classList.remove('active-slider-group');
                if (sliders[id].isSidebar && !wasSidebarLocked) {
                    document.body.classList.remove('res-sidebar-locked');
                    applyDynamicStyles();
                }
            };

            slider.addEventListener('mousedown', startPreview);
            slider.addEventListener('touchstart', startPreview, { passive: true });
            slider.addEventListener('mouseup', endPreview);
            slider.addEventListener('touchend', endPreview);
        }
    }


    // --- 3. FEATURE MODULES ---

    function initializeSidebar() {
        const sidebar = document.querySelector('div.side');
        const content = document.querySelector('div.content');
        const header = document.getElementById('header');
        if (!sidebar || !content || sidebar.classList.contains('res-initialized')) return;
        sidebar.classList.add('res-initialized');

        const headerHeight = header ? header.offsetHeight : 50;
        const position = GM_getValue('res_sidebar_position', 'left');
        const isRight = position === 'right';

        GM_addStyle(`
            body.res-sidebar-active .side {
                position: fixed !important; top: ${headerHeight}px !important; ${position}: 0;
                height: calc(100vh - ${headerHeight}px) !important;
                z-index: 999; transition: transform 0.35s ease-in-out, width 0.35s ease-in-out;
                box-shadow: ${isRight ? '-5px' : '5px'} 0 15px rgba(0,0,0,0.2);
                display: flex !important;
                padding: 0 !important; margin: 0 !important;
            }
            body.res-sidebar-locked .side { transform: translateX(0) !important; }
            .res-sidebar-handle { height: 100%; background-color: #333; box-shadow: inset ${isRight ? '-2px' : '2px'} 0 5px rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; cursor: pointer; flex-shrink: 0; }
            .res-sidebar-handle svg { color: white; width: 24px; height: 24px; transition: transform 0.3s ease; transform: ${isRight ? 'rotate(0deg)' : 'rotate(180deg)'}; }
            body.res-sidebar-locked .res-sidebar-handle svg { transform: ${isRight ? 'rotate(180deg)' : 'rotate(0deg)'}; }
            .res-content-wrapper { flex-grow: 1; width: 0; height: 100%; overflow-y: auto; background-color: #F6F7F8; padding: 16px; }
            html.res-is-dark .res-content-wrapper { background-color: #272729 !important; }
        `);

        const chevronIconSVG = `<svg class="res-chevron-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg>`;
        const handle = document.createElement('div');
        handle.className = 'res-sidebar-handle';
        handle.innerHTML = chevronIconSVG;

        const contentWrapper = document.createElement('div');
        contentWrapper.className = 'res-content-wrapper';
        while (sidebar.firstChild) contentWrapper.appendChild(sidebar.firstChild);

        if (isRight) {
            sidebar.insertBefore(handle, sidebar.firstChild);
            sidebar.appendChild(contentWrapper);
        } else {
            sidebar.appendChild(contentWrapper);
            sidebar.appendChild(handle);
        }

        handle.addEventListener('click', () => {
            GM_setValue('res_sidebar_locked', !GM_getValue('res_sidebar_locked', false));
            applySidebarState();
        });
        document.body.classList.add('res-sidebar-active');
    }

    function destroySidebar() {
        const sidebar = document.querySelector('div.side.res-initialized');
        if (!sidebar) return;
        document.body.classList.remove('res-sidebar-active', 'res-sidebar-locked', 'res-sidebar-left', 'res-sidebar-right');
        document.querySelector('div.content').style.cssText = '';
        const handle = sidebar.querySelector('.res-sidebar-handle');
        const contentWrapper = sidebar.querySelector('.res-content-wrapper');
        if (contentWrapper) {
            while (contentWrapper.firstChild) sidebar.appendChild(contentWrapper.firstChild);
            contentWrapper.remove();
        }
        if (handle) handle.remove();
        sidebar.style = '';
        sidebar.classList.remove('res-initialized');
    }

    function applySidebarState() {
        if (!document.body.classList.contains('res-sidebar-active')) return;
        const position = GM_getValue('res_sidebar_position', 'left');
        document.body.classList.toggle('res-sidebar-right', position === 'right');
        document.body.classList.toggle('res-sidebar-left', position === 'left');
        const isLocked = GM_getValue('res_sidebar_locked', false);
        document.body.classList.toggle('res-sidebar-locked', isLocked);
        applyDynamicStyles();
    }

    function toggleSubredditCSS(enabled) {
        if (enabled) {
            if (cssObserver) return;
            const removeStyles = () => document.querySelectorAll('link[title^="applied_subreddit_"]').forEach(l => l.remove());
            removeStyles();
            cssObserver = new MutationObserver(removeStyles);
            cssObserver.observe(document.documentElement, { childList: true, subtree: true });
        } else {
            if (cssObserver) {
                cssObserver.disconnect();
                cssObserver = null;
            }
        }
    }

    function toggleAutoHideComments(enabled) {
        const commentArea = document.querySelector('.commentarea');
        if (!commentArea) return;
        if (enabled) {
            const addToggle = (comment) => {
                if (comment.querySelector('.res-child-toggle') || !comment.querySelector(':scope > .child')) return;
                const flatList = comment.querySelector(':scope > .entry > .flat-list.buttons');
                if (!flatList) return;
                const toggleBtn = document.createElement('a');
                toggleBtn.href = 'javascript:void(0)';
                toggleBtn.className = 'res-child-toggle';
                toggleBtn.textContent = '[+]';
                toggleBtn.style.marginLeft = '5px';
                const li = document.createElement('li');
                li.appendChild(toggleBtn);
                flatList.appendChild(li);
                const childDiv = comment.querySelector(':scope > .child');
                childDiv.style.display = 'none';
                toggleBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    const isHidden = childDiv.style.display === 'none';
                    childDiv.style.display = isHidden ? '' : 'none';
                    toggleBtn.textContent = isHidden ? '[-]' : '[+]';
                });
            };
            commentArea.querySelectorAll('.comment').forEach(addToggle);
            if (commentsObserver) commentsObserver.disconnect();
            commentsObserver = new MutationObserver(mutations => {
                mutations.forEach(mutation => {
                    mutation.addedNodes.forEach(node => {
                        if (node.nodeType === 1) {
                           if (node.matches('.comment')) addToggle(node);
                           node.querySelectorAll('.comment').forEach(addToggle);
                        }
                    });
                });
            });
            commentsObserver.observe(commentArea, { childList: true, subtree: true });
        } else {
            if (commentsObserver) commentsObserver.disconnect();
            commentsObserver = null;
            document.querySelectorAll('.res-child-toggle').forEach(btn => btn.parentElement.remove());
            document.querySelectorAll('.comment > .child').forEach(child => child.style.display = '');
        }
    }

    function toggleOldFavicon(enabled) {
        const existingIcons = [...document.querySelectorAll('link[rel~="icon"]')];
        if (!originalFavicon && existingIcons.length > 0) {
            originalFavicon = existingIcons[0].href;
        }
        if (enabled) {
            existingIcons.forEach(icon => icon.href = OLD_FAVICON_URL);
        } else {
            if (originalFavicon) {
                existingIcons.forEach(icon => icon.href = originalFavicon);
            }
        }
    }

    function toggleElementVisibility(enabled, styleId, selector) {
        let styleTag = document.getElementById(styleId);
        if (enabled) {
            if (!styleTag) {
                GM_addStyle(`${selector} { display: none !important; }`, styleId);
            }
        } else {
            if (styleTag) {
                styleTag.remove();
            }
        }
    }

    function startThemePreview() {
        if (previewInterval) clearInterval(previewInterval);
        document.getElementById('res-theme-countdown')?.remove();

        const overlay = document.getElementById('res-modal-overlay');
        overlay.classList.add('theme-preview-active');

        const countdownEl = document.createElement('div');
        countdownEl.id = 'res-theme-countdown';
        document.body.appendChild(countdownEl);

        let count = 3;
        const updateCountdownText = (c) => {
            countdownEl.innerHTML = `Theme Preview<br><span style="font-size: 1.5em; font-weight: bold;">${c}</span>`;
        };

        updateCountdownText(count);

        previewInterval = setInterval(() => {
            count--;
            if (count > 0) {
                updateCountdownText(count);
            } else {
                clearInterval(previewInterval);
                previewInterval = null;
                overlay.classList.remove('theme-preview-active');
                countdownEl.remove();
            }
        }, 1000);
    }

    function resetTheme() {
        document.getElementById('res-dark-theme')?.remove();
        document.getElementById('res-catppuccin-theme')?.remove();
        document.getElementById('res-clean-theme')?.remove();
        document.documentElement.classList.remove('dark-mode', 'res-is-dark');
    }

    function applyTheme() {
        resetTheme();

        const selectedTheme = GM_getValue('res_theme', 'none');
        let isDarkTheme = false;

        switch (selectedTheme) {
            case 'dark':
                GM_addStyle(GM_getResourceText('DARK_THEME'), 'res-dark-theme');
                isDarkTheme = true;
                break;
            case 'catppuccin':
                GM_addStyle(GM_getResourceText('CATPPUCCIN_THEME'), 'res-catppuccin-theme');
                isDarkTheme = true;
                break;
            case 'clean_light':
                GM_addStyle(GM_getResourceText('CLEAN_THEME'), 'res-clean-theme');
                break;
            case 'clean_dark':
                GM_addStyle(GM_getResourceText('CLEAN_THEME'), 'res-clean-theme');
                document.documentElement.classList.add('dark-mode');
                isDarkTheme = true;
                break;
        }

        if (isDarkTheme) {
            document.documentElement.classList.add('res-is-dark');
        }
    }

    function applyMultiredditMods() {
        const styleId = 'res-multireddit-swap-style';
        let styleTag = document.getElementById(styleId);

        const swapEnabled = GM_getValue('res_swap_sidebar_enabled', false);
        const sidebarOnLeft = GM_getValue('res_sidebar_position', 'left') === 'left';

        // --- Feature 1: Swap position with main sidebar ---
        if (swapEnabled && sidebarOnLeft) {
            if (!styleTag) {
                styleTag = document.createElement('style');
                styleTag.id = styleId;
                document.head.appendChild(styleTag);
            }
            const headerHeight = document.getElementById('header')?.offsetHeight || 50;
            styleTag.textContent = `
                .listing-chooser.initialized {
                    left: auto !important;
                    right: 0 !important;
                    top: ${headerHeight}px !important;
                    border-left: 1px solid #ccc;
                    border-right: none;
                }
                .listing-chooser.initialized .grippy {
                    left: auto !important;
                    right: 100%;
                    border-radius: 4px 0 0 4px;
                    margin-right: -1px;
                }
                html.res-is-dark .listing-chooser.initialized {
                     border-left-color: #333 !important;
                }
            `;
        } else {
            // Remove the swap style if it exists and conditions aren't met
            styleTag?.remove();
        }

        // --- Feature 2: Re-order grippies when NOT swapped (original feature) ---
        if (!swapEnabled && sidebarOnLeft && window.location.pathname === '/') {
            const multiRedditGrippy = document.querySelector('.listing-chooser .grippy');
            const resSidebarHandle = document.querySelector('.res-sidebar-handle');
            const parent = resSidebarHandle?.parentNode;

            if (multiRedditGrippy && resSidebarHandle && parent) {
                parent.insertBefore(multiRedditGrippy, resSidebarHandle);
            }
        }
    }


    // --- 4. DYNAMIC & MAIN SETTINGS ORCHESTRATOR ---

    function applyDynamicStyles() {
        if (!dynamicStyleTag) {
            dynamicStyleTag = document.createElement('style');
            dynamicStyleTag.id = 'res-dynamic-styles';
            document.head.appendChild(dynamicStyleTag);
        }

        const sidebarWidth = document.getElementById('res-setting-sidebar-width').value;
        const handleWidth = document.getElementById('res-setting-handle-width').value;
        const commentWidth = document.getElementById('res-setting-comment-width').value;
        const sidebarFloat = document.getElementById('res-setting-sidebar-float').checked;
        const position = GM_getValue('res_sidebar_position', 'left');
        const isRight = position === 'right';
        const marginDir = isRight ? 'margin-right' : 'margin-left';

        let isLocked = document.body.classList.contains('res-sidebar-locked');
        let margin = (isLocked ? sidebarWidth : handleWidth) + 'px';
        if (sidebarFloat || !GM_getValue('res_sidebar_enabled', true)) {
            margin = '0px';
        }

        dynamicStyleTag.textContent = `
            body.res-sidebar-active .side {
                width: ${sidebarWidth}px;
                transform: translateX(${isRight ? `calc(100% - ${handleWidth}px)` : `calc(-100% + ${handleWidth}px)`});
            }
            .res-sidebar-handle {
                width: ${handleWidth}px;
            }
            .content {
                ${marginDir}: ${margin} !important;
                transition: ${marginDir} 0.35s ease-in-out;
            }
            .sitetable.nestedlisting {
                max-width: ${commentWidth}px;
            }
        `;
    }

    function applySettings() {
        // Load settings into modal
        document.getElementById('res-setting-force-old-reddit').checked = GM_getValue('res_force_old_reddit_enabled', true);
        document.getElementById('res-setting-sidebar').checked = GM_getValue('res_sidebar_enabled', true);
        document.getElementById('res-setting-sidebar-float').checked = GM_getValue('res_sidebar_float', false);
        document.getElementById('res-setting-theme').value = GM_getValue('res_theme', 'none');
        document.getElementById('res-setting-no-css').checked = GM_getValue('res_no_css_enabled', false);
        document.getElementById('res-setting-hide-comments').checked = GM_getValue('res_hide_comments_enabled', false);
        document.getElementById('res-setting-hide-deleted').checked = GM_getValue('res_hide_deleted_enabled', false);
        document.getElementById('res-setting-old-favicon').checked = GM_getValue('res_old_favicon_enabled', false);
        const position = GM_getValue('res_sidebar_position', 'left');
        document.getElementById(`res-sidebar-pos-${position}`).checked = true;

        document.getElementById('res-setting-hide-premium').checked = GM_getValue('res_hide_premium_banner', false);
        document.getElementById('res-setting-hide-new-reddit').checked = GM_getValue('res_hide_get_new_reddit_btn', false);
        document.getElementById('res-setting-hide-multireddit').checked = GM_getValue('res_hide_multireddit_panel', false);
        document.getElementById('res-setting-swap-sidebar').checked = GM_getValue('res_swap_sidebar_enabled', false);

        const sliders = {
            'res-setting-sidebar-width': { key: 'res_sidebar_width', valueId: 'res-sidebar-width-value', units: 'px', default: 310 },
            'res-setting-handle-width': { key: 'res_handle_width', valueId: 'res-handle-width-value', units: 'px', default: 30 },
            'res-setting-comment-width': { key: 'res_comment_width', valueId: 'res-comment-width-value', units: 'px', default: 850 }
        };
        for (const id in sliders) {
            const slider = document.getElementById(id);
            const valueDisplay = document.getElementById(sliders[id].valueId);
            slider.value = GM_getValue(sliders[id].key, sliders[id].default);
            valueDisplay.textContent = `${slider.value}${sliders[id].units}`;
            slider.addEventListener('input', () => {
                 valueDisplay.textContent = `${slider.value}${sliders[id].units}`;
            });
        }

        document.querySelectorAll('.res-setting-group').forEach(group => {
            const groupId = group.dataset.groupId;
            if (GM_getValue(`res_group_${groupId}_collapsed`, false)) {
                group.classList.add('collapsed');
            }
        });

        // Apply features
        if (GM_getValue('res_sidebar_enabled', true)) {
            if (!document.querySelector('.res-sidebar-handle')) initializeSidebar();
            applySidebarState();
        } else {
            destroySidebar();
        }

        applyTheme();
        toggleSubredditCSS(GM_getValue('res_no_css_enabled', false));
        toggleAutoHideComments(GM_getValue('res_hide_comments_enabled', false));
        toggleOldFavicon(GM_getValue('res_old_favicon_enabled', false));
        applyDynamicStyles();

        toggleElementVisibility(GM_getValue('res_hide_premium_banner', false), 'res-hide-premium-style', '.premium-banner-outer');
        toggleElementVisibility(GM_getValue('res_hide_get_new_reddit_btn', false), 'res-hide-new-reddit-style', '#redesign-beta-optin-btn');
        toggleElementVisibility(GM_getValue('res_hide_multireddit_panel', false), 'res-hide-multireddit-style', '.listing-chooser.initialized');

        applyMultiredditMods();
    }

    // --- 5. INITIALIZATION ---
    function init() {
        // This function runs only after the redirect check has passed.
        // It's safe to assume we are on old.reddit.com here.
        injectBaseStyles();
        createSettingsPanel();
        applySettings();

        if (sessionStorage.getItem('res-settings-open') === 'true') {
            document.getElementById('res-modal-overlay').style.display = 'block';
            sessionStorage.removeItem('res-settings-open');
        }

        if (sessionStorage.getItem('res-theme-preview') === 'true') {
            startThemePreview();
            sessionStorage.removeItem('res-theme-preview');
        }
    }

    // The script waits until the DOM is interactive to initialize the UI elements.
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
