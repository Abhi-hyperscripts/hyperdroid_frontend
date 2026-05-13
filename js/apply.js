/* Public candidate-facing apply page.
   Reads webhook key from ?k= query param, fetches form schema from HRMS
   anonymous capture endpoint, renders the form, submits as JSON.
   This page is NOT authenticated — the webhook key is the only credential.
*/
(function () {
    'use strict';

    const params = new URLSearchParams(window.location.search);
    const webhookKey = (params.get('k') || params.get('key') || '').trim();

    let formConfig = null;

    document.addEventListener('DOMContentLoaded', loadConfig);

    async function loadConfig() {
        if (!webhookKey) return showNotFound();
        try {
            const url = `${getApiBase()}/recruitment/apply/${encodeURIComponent(webhookKey)}/form-config`;
            const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
            if (res.status === 404) return showNotFound();
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            formConfig = await res.json();
            renderForm(formConfig);
        } catch (err) {
            console.error('loadConfig failed', err);
            showNotFound();
        }
    }

    function renderForm(cfg) {
        hideAllStates();
        document.getElementById('applyContent').style.display = '';

        // Apply tenant-selected theme via [data-theme] on <html>. Default dark.
        const theme = (cfg.theme === 'light') ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', theme);

        document.title = (cfg.title ? cfg.title + ' — ' : '') + 'Apply | Ragenaizer';

        // Splash a serif-italic accent on the LAST word of the title for the
        // editorial Wisetrack-style display headline. If the title is a
        // single word, leave it plain.
        const titleEl = document.getElementById('applyTitle');
        const t = (cfg.title || 'Job Application').trim();
        const lastSpace = t.lastIndexOf(' ');
        if (lastSpace > 0 && lastSpace < t.length - 1) {
            titleEl.innerHTML = `${escapeHtml(t.slice(0, lastSpace))} <span class="serif-italic text-gradient">${escapeHtml(t.slice(lastSpace + 1))}</span>`;
        } else {
            titleEl.textContent = t;
        }

        // Reveal the sticky "Apply now" CTA in the top bar now that we have content
        document.getElementById('topBarCta').style.display = '';

        // Status-strip location text
        const statusLoc = document.getElementById('statusLocation');
        if (statusLoc && cfg.location) statusLoc.textContent = cfg.location.toUpperCase() + ' · ';

        // Inline meta chips (just location + type at a glance)
        const heroMeta = document.getElementById('applyHeroMeta');
        const chips = [];
        if (cfg.location) chips.push(`<span class="tag tag-violet">${escapeHtml(cfg.location)}</span>`);
        if (cfg.employment_type) chips.push(`<span class="tag tag-cyan">${escapeHtml(formatEmploymentType(cfg.employment_type))}</span>`);
        heroMeta.innerHTML = chips.join('');

        // Stat boxes (COMP-style meta)
        renderStatGrid(cfg);

        // Banner + logo — both render INSIDE the unified HUD frame card now
        // (no more separate banner section below the hero).
        const safe = (u) => typeof u === 'string' && /^https?:\/\//i.test(u);
        const hudFrame = document.getElementById('hudFrame');
        if (safe(cfg.banner_url)) {
            const banner = document.getElementById('hudBanner');
            document.getElementById('hudBannerImg').src = cfg.banner_url;
            banner.style.display = '';
            hudFrame.classList.add('has-banner');
        }
        if (safe(cfg.logo_url)) {
            // Logo is meaningful only when there's a banner to anchor it to;
            // if there's a logo but no banner, synthesise a soft gradient
            // banner so the logo has a place to live.
            if (!safe(cfg.banner_url)) {
                const banner = document.getElementById('hudBanner');
                const img = document.getElementById('hudBannerImg');
                img.removeAttribute('src');
                img.style.background = 'linear-gradient(135deg, #312e81 0%, #1e1b4b 60%, #0c0a1a 100%)';
                banner.style.display = '';
                hudFrame.classList.add('has-banner');
            }
            const logoWrap = document.getElementById('hudBannerLogo');
            const logoImg = document.getElementById('hudBannerLogoImg');
            logoImg.src = cfg.logo_url;
            logoImg.alt = 'Company logo';
            logoWrap.style.display = '';
        }

        // ── HUD corner labels: only render real data, no decorative placeholders ──
        const safeUrl = (u) => typeof u === 'string' && /^https?:\/\//i.test(u);

        // Top-left: company website link (when set)
        const hudWebsite = document.getElementById('hudWebsite');
        if (hudWebsite && safeUrl(cfg.company_website)) {
            const url = cfg.company_website;
            const display = url.replace(/^https?:\/\//i, '').replace(/\/$/, '');
            hudWebsite.innerHTML = `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
                <a href="${escapeAttr(url)}" target="_blank" rel="noopener">${escapeHtml(display)}</a>
            `;
        }

        // Top-right: company name
        const hudCompany = document.getElementById('hudCompany');
        if (hudCompany && cfg.company_name && cfg.company_name.trim()) {
            hudCompany.textContent = cfg.company_name.trim();
        }

        // Bottom-right: posted date (real date if backend provided posted_at,
        // otherwise omit — no fake REV stamps)
        const hudPosted = document.getElementById('hudPosted');
        if (hudPosted && cfg.posted_at) {
            const d = new Date(cfg.posted_at);
            if (!Number.isNaN(d.getTime())) {
                const opts = { year: 'numeric', month: 'short', day: 'numeric' };
                hudPosted.textContent = 'POSTED · ' + d.toLocaleDateString('en-GB', opts).toUpperCase();
            }
        }

        // ── Company "at" line above the title ──
        if (cfg.company_name && cfg.company_name.trim()) {
            document.getElementById('heroCompanyName').textContent = cfg.company_name.trim();
            document.getElementById('heroCompanyLine').style.display = '';
        }

        // ── Map embed (when both lat + lng are provided) ──
        const lat = cfg.office_latitude;
        const lng = cfg.office_longitude;
        if (typeof lat === 'number' && typeof lng === 'number' &&
            lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
            const section = document.getElementById('mapSection');
            const iframe = document.getElementById('mapIframe');
            // OpenStreetMap embed — no API key required, decent for showing
            // a marker. ~0.005° box ≈ 500m around the marker.
            const dx = 0.006;
            const bbox = `${lng - dx},${lat - dx},${lng + dx},${lat + dx}`;
            iframe.src = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lng}`;
            document.getElementById('mapCoords').textContent = `LAT ${lat.toFixed(5)} · LNG ${lng.toFixed(5)}`;
            document.getElementById('mapDirectionsLink').href = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
            section.style.display = '';
        }

        const descEl = document.getElementById('applyDescription');
        if (cfg.description && cfg.description.trim()) {
            let html = cfg.description;
            // Strip a leading "About the role" plain-text duplicate that often
            // appears as the first paragraph because users naturally retype the
            // section name; the page already labels the column.
            html = html.replace(/^\s*<p[^>]*>About the role<\/p>\s*/i, '');
            // Sanitize Quill-authored HTML before innerHTML — DOMPurify loaded
            // from CDN in apply.html. Public page = highest-blast XSS surface.
            descEl.innerHTML = (typeof DOMPurify !== 'undefined') ? DOMPurify.sanitize(html) : '';
            enhanceDescription(descEl);
        } else {
            descEl.innerHTML = '<p style="color: var(--muted); font-style: italic;">No description provided. Reach out to the hiring team if you have questions.</p>';
        }

        // Share links
        const url = window.location.href;
        const text = `${cfg.title || 'A role at Ragenaizer'} — ${cfg.location || ''}`.trim();
        document.getElementById('shareLinkedIn').href =
            `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`;
        document.getElementById('shareTwitter').href =
            `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;

        const wrap = document.getElementById('applyFields');
        wrap.innerHTML = '';
        const fields = Array.isArray(cfg.fields) ? cfg.fields : [];
        if (fields.length === 0) {
            wrap.innerHTML = '<p style="grid-column: 1 / -1; color: var(--muted-2);">This posting has no application fields configured. Please contact the hiring team.</p>';
            document.getElementById('applySubmitBtn').disabled = true;
            return;
        }

        // Group fields into sections based on field key. The grouping is best-
        // effort: known keys go into "About you" / "Where to find you" /
        // "Your background"; anything else goes into "More about you" so HR's
        // custom fields still render together at the end.
        const groups = buildFieldGroups(fields);
        groups.forEach(g => wrap.appendChild(renderGroup(g)));
    }

    function buildFieldGroups(fields) {
        const ABOUT = ['full_name', 'name', 'first_name', 'last_name', 'email', 'phone', 'mobile', 'tel'];
        const LINKS = ['linkedin_profile_url', 'linkedin', 'portfolio_or_github_url', 'portfolio', 'github', 'website'];
        const BACKGROUND = ['current_company', 'company', 'current_role_title', 'current_role', 'job_title', 'role',
                            'years_of_experience', 'experience', 'notice_period'];
        const FREE = ['why_this_role', 'cover_letter', 'message', 'notes'];

        const bucket = (key) => {
            const k = (key || '').toLowerCase();
            if (ABOUT.includes(k)) return 'about';
            if (LINKS.includes(k)) return 'links';
            if (BACKGROUND.includes(k)) return 'background';
            if (FREE.includes(k)) return 'free';
            return 'other';
        };

        const order = ['about', 'links', 'background', 'other', 'free'];
        const titles = {
            about: 'About you',
            links: 'Where to find you',
            background: 'Your background',
            other: 'More about you',
            free: 'A few words'
        };

        const buckets = { about: [], links: [], background: [], other: [], free: [] };
        fields.forEach(f => buckets[bucket(f.key)].push(f));

        return order
            .filter(b => buckets[b].length > 0)
            .map(b => ({ key: b, title: titles[b], fields: buckets[b] }));
    }

    function renderGroup(group) {
        const wrap = document.createElement('div');
        wrap.className = 'form-group';
        const title = document.createElement('div');
        title.className = 'form-group-title';
        title.textContent = group.title;
        wrap.appendChild(title);

        // Single-column row — every field gets the full form width so
        // candidates have plenty of room to type, and short fields like
        // Email + Phone don't get squeezed side-by-side.
        const row = document.createElement('div');
        row.className = 'apply-form-row';
        group.fields.forEach(f => row.appendChild(renderField(f)));
        wrap.appendChild(row);
        return wrap;
    }

    function hideAllStates() {
        ['applyLoading', 'applyNotFound', 'applySuccess', 'applyContent'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });
    }

    function renderStatGrid(cfg) {
        // Stats now flow INTO the hero-meta-row alongside the location +
        // employment-type chips so we don't waste a whole second row on
        // a single OPENINGS pill. The standalone .stat-grid is hidden.
        const grid = document.getElementById('applyStatGrid');
        if (grid) grid.style.display = 'none';

        const meta = document.getElementById('applyHeroMeta');
        if (!meta) return;

        // OPENINGS is the only piece of meta that has no other slot — and
        // only meaningful when there are multiple positions.
        if (cfg.openings && cfg.openings > 1) {
            const stat = document.createElement('span');
            stat.className = 'stat-box';
            stat.innerHTML = `
                <span class="label">${escapeHtml('OPENINGS')}</span>
                <span class="value">${escapeHtml(String(cfg.openings))}</span>
            `;
            meta.appendChild(stat);
        }
    }

    /**
     * Post-process the rich-text description so HR's plain-paragraph copy
     * gets editorial structure even when they didn't click Quill's H2/list
     * buttons:
     *   1. Drop a "drop cap" on the first paragraph (when long enough).
     *   2. Detect short stand-alone paragraphs that look like section
     *      headings (no terminal punctuation, < 80 chars, sentence case)
     *      and upgrade them to <h3 class="auto-heading">.
     *   3. Detect runs of consecutive short paragraphs separated by blank
     *      paragraphs — those are usually "lists by hand-break" and get
     *      wrapped in a styled .auto-list with bullet items.
     */
    function enhanceDescription(root) {
        // Walk only the direct children — we operate at paragraph level.
        const nodes = Array.from(root.children);
        if (nodes.length === 0) return;

        // 1. Auto-headings — a paragraph is a heading if:
        //    - it's a <p>
        //    - text is short (<= 80 chars after trimming)
        //    - has no trailing terminal punctuation (.!?)
        //    - is followed by another paragraph (not the last node)
        //    - doesn't start with a bullet/number marker
        const isHeadingLike = (el) => {
            if (!el || el.tagName !== 'P') return false;
            const t = (el.textContent || '').trim();
            if (t.length === 0 || t.length > 80) return false;
            if (/[.!?:;,]$/.test(t)) return false;
            if (/^[•\-–—*]\s/.test(t) || /^\d+[.)]\s/.test(t)) return false;
            // Must look like a phrase, not a single word run-on
            if (t.split(/\s+/).length > 12) return false;
            return true;
        };

        for (let i = 0; i < nodes.length; i++) {
            const el = nodes[i];
            // Don't promote the very first paragraph if it's just a stub
            // (we want a real intro paragraph there).
            if (i === 0 && nodes.length > 1 && isHeadingLike(el) && nodes[1] && nodes[1].tagName === 'P') {
                // First node IS a heading-like phrase — promote it.
                promoteToHeading(el);
                continue;
            }
            // Heading sandwich: heading-like paragraph followed by a real body
            if (isHeadingLike(el) && i + 1 < nodes.length) {
                const next = nodes[i + 1];
                if (next.tagName === 'P' && (next.textContent || '').trim().length > 30) {
                    promoteToHeading(el);
                }
            }
        }

        // 2. Drop cap on the first body paragraph that's long enough
        const firstBody = root.querySelector('p:not(.auto-heading)');
        if (firstBody && (firstBody.textContent || '').trim().length > 120) {
            firstBody.classList.add('with-dropcap');
        }

        // 3. List-by-hand-break detection: find runs of 2+ consecutive
        //    paragraphs that look like list items (short, no terminal
        //    punctuation OR start with bullet markers) — wrap in .auto-list.
        const isListItemLike = (el) => {
            if (!el || el.tagName !== 'P') return false;
            const t = (el.textContent || '').trim();
            if (t.length === 0 || t.length > 220) return false;
            if (/^[•\-–—*]\s/.test(t) || /^\d+[.)]\s/.test(t)) return true;
            // Otherwise: treat short non-terminated lines as list items
            // ONLY if grouped together (the calling loop checks for runs).
            return t.length <= 180 && !/[.!?]$/.test(t);
        };

        // Re-snapshot children since we added auto-headings.
        let kids = Array.from(root.children);
        let i = 0;
        while (i < kids.length) {
            const el = kids[i];
            if (el.classList && el.classList.contains('auto-heading')) { i++; continue; }
            if (!isListItemLike(el)) { i++; continue; }

            // Found a candidate. Walk forward to find the run.
            let j = i;
            while (j < kids.length && isListItemLike(kids[j]) && !kids[j].classList.contains('auto-heading')) {
                j++;
            }
            // Need at least 2 items to call it a list.
            if (j - i < 2) { i = j + 1; continue; }

            // Wrap the run in <div class="auto-list">.
            const list = document.createElement('div');
            list.className = 'auto-list';
            for (let k = i; k < j; k++) {
                const item = document.createElement('div');
                item.className = 'auto-list-item';
                // Strip leading bullet/number markers since we render our own.
                let text = kids[k].innerHTML;
                text = text.replace(/^\s*([•\-–—*]|\d+[.)])\s+/, '');
                item.innerHTML = text;
                list.appendChild(item);
            }
            kids[i].parentNode.insertBefore(list, kids[i]);
            for (let k = i; k < j; k++) kids[k].remove();

            // Refresh kids snapshot
            kids = Array.from(root.children);
            i = i + 1;
        }

        // Finally — number every heading with §01, §02, … for the editorial
        // section markers. Done after promotions so numbering is contiguous.
        numberAutoHeadings(root);
    }

    function promoteToHeading(p) {
        const h = document.createElement('h3');
        h.className = 'auto-heading';
        h.innerHTML = p.innerHTML;
        p.parentNode.replaceChild(h, p);
    }

    // Number the auto-headings after enhancement: §01, §02, … so the editorial
    // section markers feel like a real magazine. Called at the end of
    // enhanceDescription via setTimeout(0).
    function numberAutoHeadings(root) {
        const headings = root.querySelectorAll('.auto-heading, h1, h2, h3');
        let n = 0;
        headings.forEach(h => {
            n += 1;
            const num = String(n).padStart(2, '0');
            h.setAttribute('data-section', `§ ${num}`);
        });
    }

    // Icon map keyed by field-key fragment. Returns inline SVG markup.
    function iconForKey(key, type) {
        const k = (key || '').toLowerCase();
        const ICONS = {
            person: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
            mail:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>',
            phone:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>',
            linkedin:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.45 20.45h-3.55v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.13 1.45-2.13 2.95v5.66H9.36V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.45zM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12zM7.12 20.45H3.56V9h3.56z"/></svg>',
            link:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
            building:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M5 21V7l8-4v18"/><path d="M19 21V11l-6-4"/></svg>',
            badge:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="12" cy="10" r="3"/><path d="M7 20s1-4 5-4 5 4 5 4"/></svg>',
            clock:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
            chart:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 17 9 11 13 15 21 7"/><polyline points="14 7 21 7 21 14"/></svg>'
        };

        if (k.includes('full_name') || k === 'name' || k.includes('first_name') || k.includes('last_name'))
            return ICONS.person;
        if (k === 'email' || type === 'email') return ICONS.mail;
        if (k === 'phone' || k.includes('mobile') || type === 'tel') return ICONS.phone;
        if (k.includes('linkedin')) return ICONS.linkedin;
        if (k.includes('portfolio') || k.includes('github') || k.includes('website') || k.includes('url'))
            return ICONS.link;
        if (k.includes('company')) return ICONS.building;
        if (k.includes('role') || k.includes('title') || k.includes('designation')) return ICONS.badge;
        if (k.includes('notice')) return ICONS.clock;
        if (k.includes('experience') || k.includes('years')) return ICONS.chart;
        return null;
    }

    function renderField(f) {
        const wrap = document.createElement('div');
        wrap.className = 'apply-field';
        // Wide fields take the full row in the 2-col grid:
        //   - textarea / multiselect always (need vertical space)
        //   - radio when there are more than 3 options (otherwise crowded)
        // The backend defaults `width: 'full'` on every field as a legacy
        // fallback, so we DO NOT honour it here — type-based rules only,
        // otherwise every field would span full and the 2-col grid wouldn't
        // do anything.
        const optsLen = (f.options || []).length;
        const spansFull =
            f.type === 'textarea' ||
            f.type === 'multiselect' ||
            (f.type === 'radio' && optsLen > 3);
        if (spansFull) wrap.classList.add('apply-field--full');
        // (We no longer honour f.width === 'half'; every field renders full-width
        // so candidates always get the full form width to type into.)

        const id = `f_${f.key}`;
        const required = !!f.required;
        const placeholder = f.placeholder || '';
        const labelHtml = `<label for="${id}">${escapeHtml(f.label || f.key)}${required ? '<span class="req">*</span>' : ''}</label>`;

        // Per-type attribute helpers — emit native HTML constraints so the
        // browser does the first pass of validation and the backend's stricter
        // checks catch the rest. Using attributes (not classes) keeps the
        // markup aligned with what `<input type="...">` already understands.
        const minAttr  = (f.min  != null) ? ` min="${escapeAttr(String(f.min))}"`   : '';
        const maxAttr  = (f.max  != null) ? ` max="${escapeAttr(String(f.max))}"`   : '';
        const minDate  = f.min_date ? ` min="${escapeAttr(f.min_date)}"`             : '';
        const maxDate  = f.max_date ? ` max="${escapeAttr(f.max_date)}"`             : '';
        const minLen   = (f.min_length != null) ? ` minlength="${escapeAttr(String(f.min_length))}"` : '';
        const maxLen   = ` maxlength="${escapeAttr(String(f.max_length || 500))}"`;
        const tareaMax = ` maxlength="${escapeAttr(String(f.max_length || 5000))}"`;

        // Decide control HTML based on type
        let control;
        switch (f.type) {
            case 'textarea':
                control = `<textarea id="${id}" name="${escapeAttr(f.key)}" ${required ? 'required' : ''} placeholder="${escapeAttr(placeholder)}"${tareaMax}${minLen}></textarea>`;
                break;
            case 'select':
                {
                    const opts = (f.options || []).map(o =>
                        `<option value="${escapeAttr(o.value)}">${escapeHtml(o.label || o.value)}</option>`).join('');
                    control = `<select id="${id}" name="${escapeAttr(f.key)}" ${required ? 'required' : ''}>
                                  <option value="">Select…</option>${opts}
                               </select>`;
                }
                break;
            case 'country':
                {
                    // Backend ships the country options on the form-config so HR
                    // doesn't have to maintain a list. Sorted by name already.
                    const opts = (f.options || []).map(o =>
                        `<option value="${escapeAttr(o.value)}">${escapeHtml(o.label || o.value)}</option>`).join('');
                    control = `<select id="${id}" name="${escapeAttr(f.key)}" ${required ? 'required' : ''}>
                                  <option value="">Select country…</option>${opts}
                               </select>`;
                }
                break;
            case 'multiselect':
                {
                    // iOS-style toggle switch per option. Native checkbox
                    // is hidden but kept inside the form so the submit
                    // handler still picks up checked values via name.
                    // The visible track + knob are CSS-only, driven by
                    // input:checked + .toggle-track in apply.html.
                    const items = (f.options || []).map(o => {
                        const optId = `${id}__${slugifyClient(o.value)}`;
                        return `<label class="apply-checkbox-item" for="${optId}">
                                    <span class="toggle-label">${escapeHtml(o.label || o.value)}</span>
                                    <input id="${optId}" type="checkbox" name="${escapeAttr(f.key)}" value="${escapeAttr(o.value)}">
                                    <span class="toggle-track" aria-hidden="true"></span>
                                </label>`;
                    }).join('');
                    control = `<div class="apply-checkbox-group" id="${id}" data-multiselect="1" data-required="${required ? '1' : '0'}">${items}</div>`;
                }
                break;
            case 'radio':
                {
                    const items = (f.options || []).map(o => {
                        const optId = `${id}__${slugifyClient(o.value)}`;
                        return `<label class="apply-radio-item" for="${optId}">
                                    <input id="${optId}" type="radio" name="${escapeAttr(f.key)}" value="${escapeAttr(o.value)}" ${required ? 'required' : ''}>
                                    <span>${escapeHtml(o.label || o.value)}</span>
                                </label>`;
                    }).join('');
                    control = `<div class="apply-radio-group" id="${id}" data-radio="1">${items}</div>`;
                }
                break;
            case 'yesno':
                {
                    // Two-button toggle, hidden radio inputs underneath. Mobile
                    // candidates can tap a chunky target instead of a tiny radio.
                    const optYes = `${id}__yes`, optNo = `${id}__no`;
                    control = `<div class="apply-yesno" id="${id}" data-radio="1">
                                <label class="apply-yesno-btn" for="${optYes}">
                                    <input id="${optYes}" type="radio" name="${escapeAttr(f.key)}" value="yes" ${required ? 'required' : ''}>
                                    <span>Yes</span>
                                </label>
                                <label class="apply-yesno-btn" for="${optNo}">
                                    <input id="${optNo}" type="radio" name="${escapeAttr(f.key)}" value="no" ${required ? 'required' : ''}>
                                    <span>No</span>
                                </label>
                            </div>`;
                }
                break;
            case 'email':
                control = `<input id="${id}" name="${escapeAttr(f.key)}" type="email" ${required ? 'required' : ''} placeholder="${escapeAttr(placeholder)}" autocomplete="email" maxlength="254">`;
                break;
            case 'tel':
                control = `<input id="${id}" name="${escapeAttr(f.key)}" type="tel" ${required ? 'required' : ''} placeholder="${escapeAttr(placeholder)}" autocomplete="tel" maxlength="50">`;
                break;
            case 'url':
                control = `<input id="${id}" name="${escapeAttr(f.key)}" type="url" ${required ? 'required' : ''} placeholder="${escapeAttr(placeholder || 'https://')}" autocomplete="url" maxlength="500">`;
                break;
            case 'number':
                control = `<input id="${id}" name="${escapeAttr(f.key)}" type="number" ${required ? 'required' : ''} placeholder="${escapeAttr(placeholder)}"${minAttr}${maxAttr}>`;
                break;
            case 'age':
                // Integer-only via step="1". Native pickers with min/max give a
                // mobile-friendly numeric keypad.
                control = `<input id="${id}" name="${escapeAttr(f.key)}" type="number" inputmode="numeric" step="1" ${required ? 'required' : ''} placeholder="${escapeAttr(placeholder)}"${minAttr}${maxAttr}>`;
                break;
            case 'date':
                control = `<input id="${id}" name="${escapeAttr(f.key)}" type="date" ${required ? 'required' : ''}${minDate}${maxDate}>`;
                break;
            case 'date_of_birth':
                // Same control as `date`, but the backend ships sensible default
                // bounds (today-100y .. today-14y) so the calendar lands on a
                // useful year for DOB. Browsers honour min/max automatically.
                control = `<input id="${id}" name="${escapeAttr(f.key)}" type="date" autocomplete="bday" ${required ? 'required' : ''}${minDate}${maxDate}>`;
                break;
            case 'text':
            default:
                control = `<input id="${id}" name="${escapeAttr(f.key)}" type="text" ${required ? 'required' : ''} placeholder="${escapeAttr(placeholder)}"${minLen}${maxLen}>`;
        }

        // Wrap text-like inputs with an icon prefix when we recognise the field.
        // Choice/multi controls render their own layout — no icon overlay.
        const iconableTypes = !['textarea', 'date', 'date_of_birth', 'multiselect', 'radio', 'yesno', 'select', 'country'].includes(f.type);
        const icon = iconableTypes ? iconForKey(f.key, f.type) : null;
        // Inject `class="input-icon"` into the SVG opening tag so the prefix
        // styling kicks in. Keeps the original viewBox + stroke attributes.
        const iconWithClass = icon ? icon.replace(/<svg(\s|>)/, '<svg class="input-icon" aria-hidden="true"$1') : '';
        const inputWrap = icon
            ? `<div class="input-wrap has-icon">${iconWithClass}${control}</div>`
            : `<div class="input-wrap">${control}</div>`;

        const helperHtml = f.helper_text
            ? `<small class="apply-helper">${escapeHtml(f.helper_text)}</small>` : '';

        wrap.innerHTML = labelHtml + inputWrap + helperHtml;
        return wrap;
    }

    // Local slugify for option-id construction (keeps id attributes valid).
    function slugifyClient(s) {
        return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'opt';
    }

    window.submitApplication = async function (ev) {
        ev.preventDefault();
        const btn = document.getElementById('applySubmitBtn');
        const errBox = document.getElementById('applyError');
        errBox.style.display = 'none';
        btn.disabled = true;
        const origHTML = btn.innerHTML;
        btn.textContent = 'Submitting…';

        try {
            const data = {};
            const fields = Array.isArray(formConfig?.fields) ? formConfig.fields : [];
            fields.forEach(f => {
                const id = `f_${f.key}`;

                // Multiselect → array of checked values.
                if (f.type === 'multiselect') {
                    const boxes = document.querySelectorAll(`input[type="checkbox"][name="${cssEscape(f.key)}"]`);
                    const picks = Array.from(boxes).filter(b => b.checked).map(b => b.value);
                    if (picks.length > 0) data[f.key] = picks;
                    return;
                }

                // Radio / yes-no → the value of the selected radio (or empty).
                if (f.type === 'radio' || f.type === 'yesno') {
                    const checked = document.querySelector(`input[type="radio"][name="${cssEscape(f.key)}"]:checked`);
                    if (checked) data[f.key] = checked.value;
                    return;
                }

                const el = document.getElementById(id);
                if (!el) return;
                const v = (el.value || '').trim();
                if (v !== '') data[f.key] = v;
            });

            // Forward the honeypot value. Real candidates leave it blank; bots
            // typically fill every field. Backend silently accepts-and-drops
            // the submission when this is non-empty.
            const honeypot = document.getElementById('company_country');
            if (honeypot && honeypot.value) data.company_country = honeypot.value;

            const url = `${getApiBase()}/recruitment/apply/${encodeURIComponent(webhookKey)}`;
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });

            if (res.status === 202 || res.ok) {
                hideAllStates();
                document.getElementById('applySuccess').style.display = '';
                window.scrollTo({ top: 0, behavior: 'smooth' });
                return;
            }

            let msg = 'Submission failed';
            try { const body = await res.json(); msg = body?.error || msg; } catch { /* keep generic */ }
            errBox.textContent = msg;
            // CSS default is display:none — clearing the inline style drops back
            // to none (the bug). Force block so the message is visible.
            errBox.style.display = 'block';
            errBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } catch (err) {
            console.error('submit failed', err);
            errBox.textContent = err?.message || 'Submission failed. Please try again.';
            errBox.style.display = 'block';
            errBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } finally {
            btn.disabled = false;
            btn.innerHTML = origHTML;
        }
    };

    // Tab switcher: "About the role" / "Apply". Single-pane visibility, kept
    // accessible via aria-selected. The optional `scroll` arg is true when the
    // user hits the top-bar "Apply now" button — we then ease the page up to
    // the tab strip so they don't land mid-form on long descriptions.
    window.switchApplyTab = function (which, scroll) {
        const map = {
            role:  { btn: 'tabBtnRole',  pane: 'paneRole'  },
            apply: { btn: 'tabBtnApply', pane: 'paneApply' }
        };
        const target = map[which]; if (!target) return;
        for (const k of Object.keys(map)) {
            const isActive = k === which;
            const btn  = document.getElementById(map[k].btn);
            const pane = document.getElementById(map[k].pane);
            if (btn)  { btn.classList.toggle('active', isActive); btn.setAttribute('aria-selected', String(isActive)); }
            if (pane) pane.classList.toggle('active', isActive);
        }
        if (scroll) {
            const tabs = document.querySelector('.apply-tabs');
            if (tabs) tabs.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    };

    window.copyShareLink = async function () {
        const btn = event?.target?.closest('button.share-btn');
        try {
            await navigator.clipboard.writeText(window.location.href);
            if (btn) {
                const orig = btn.textContent;
                btn.textContent = 'Copied!';
                setTimeout(() => { btn.textContent = orig; }, 1400);
            }
        } catch {
            const ta = document.createElement('textarea');
            ta.value = window.location.href;
            document.body.appendChild(ta); ta.select();
            document.execCommand('copy'); document.body.removeChild(ta);
        }
    };

    function showNotFound() {
        hideAllStates();
        document.getElementById('applyNotFound').style.display = '';
    }

    function getApiBase() {
        if (typeof CONFIG !== 'undefined') {
            try { if (CONFIG.hrmsApiBaseUrl) return CONFIG.hrmsApiBaseUrl; } catch { /* fall through */ }
        }
        return window.location.origin + '/api';
    }

    function escapeHtml(s) {
        return String(s ?? '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function escapeAttr(s) { return escapeHtml(s); }
    // CSS.escape exists in all evergreen browsers; this is a fallback for the
    // unlikely case it's missing. We use it to safely quote a field-key (which
    // can be any slug) into an attribute selector.
    function cssEscape(s) {
        if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(s);
        return String(s).replace(/([^\w-])/g, '\\$1');
    }
    function formatEmploymentType(t) {
        const map = { full_time: 'Full-time', part_time: 'Part-time', contract: 'Contract', intern: 'Internship', freelance: 'Freelance' };
        return map[t] || t;
    }
})();
