/**
 * Landing hero wave — the suite's signature data-wave, as the BACKDROP of a
 * marketing page's hero.
 *
 * Why: most product pages here open on a screenshot (assets/screens/app-*.png).
 * The pages that have no screenshot — Merch, the API reference, AI, Pricing,
 * Research, Procurement, LMS, Supply chain — open on a wall of centred text
 * with nothing to look at, which reads as an unfinished page rather than a
 * deliberate one.
 *
 * Opt in per page with a single attribute:
 *
 *     <body class="landing-page desk-landing" data-hero-wave="merch">
 *
 * BACKDROP, NOT A BAND. The wave sits behind the hero copy and bleeds to both
 * edges of the viewport. It is deliberately not a bordered box stacked under
 * the text — that reads as a graphic bolted on afterwards, and the app's own
 * dashboards do not do it that way either.
 *
 * DECORATIVE, AND SILENT ABOUT IT. In the app this same wave plots real
 * figures and carries a caption saying what they are. Here there is no data to
 * plot, so it carries NO caption, NO axis and NO numbers: it is a texture that
 * speaks the product's visual language, and it must never be dressed up to
 * imply a metric nobody measured.
 */
(function () {
  'use strict';

  var host = document.body;
  var preset = host && host.getAttribute('data-hero-wave');
  if (!preset) return;

  var hero = document.querySelector('.dk-hero');
  if (!hero) return;

  /* Each page gets its own shape, so two pages open on the same texture only
     if someone gives them the same preset. [seed, points, smoothness, dots]. */
  var PRESETS = {
    merch:        [7311, 34, 0.62, 5],
    'merch-api':  [4127, 42, 0.48, 7],
    ai:           [9043, 30, 0.72, 4],
    pricing:      [2205, 26, 0.66, 3],
    research:     [6618, 46, 0.44, 8],
    procurement:  [3390, 32, 0.58, 5],
    lms:          [8874, 28, 0.68, 4],
    'supply-chain': [5562, 38, 0.52, 6],
  };
  var cfg = PRESETS[preset] || PRESETS.merch;

  /* Deterministic. Math.random would redraw a different shape on every load,
     which turns a stable piece of page furniture into a flicker and makes any
     visual regression impossible to spot. */
  function rng(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  var W = 1200;
  var H = 260;
  var padT = 96;           /* keeps the line in the LOWER half, so hero copy
                              sits over quiet space rather than over the peak */

  function series(seed, n, vol) {
    var rand = rng(seed);
    var pts = [];
    var v = 0.45;
    for (var i = 0; i < n; i++) {
      /* A gentle upward drift plus noise. Clamped, so a run of high randoms
         cannot push the line off the top of the box. */
      v += (rand() - 0.42) * vol;
      v = Math.max(0.08, Math.min(0.95, v));
      pts.push({
        x: (i / (n - 1)) * W,
        y: padT + (1 - v) * (H - padT - 12),
      });
    }
    return pts;
  }

  /* Monotone cubic. A plain Catmull-Rom overshoots on a sharp reversal and
     the curve dips below its own minimum, which looks like data that is not
     there. Monotone never overshoots between points. */
  function path(pts) {
    if (pts.length < 2) return '';
    var d = 'M' + pts[0].x.toFixed(1) + ',' + pts[0].y.toFixed(1);
    var i;
    var m = [];
    for (i = 0; i < pts.length; i++) {
      var prev = pts[i - 1];
      var next = pts[i + 1];
      if (!prev) m.push((next.y - pts[i].y) / (next.x - pts[i].x));
      else if (!next) m.push((pts[i].y - prev.y) / (pts[i].x - prev.x));
      else {
        var d1 = (pts[i].y - prev.y) / (pts[i].x - prev.x);
        var d2 = (next.y - pts[i].y) / (next.x - pts[i].x);
        m.push(d1 * d2 <= 0 ? 0 : (d1 + d2) / 2);
      }
    }
    for (i = 1; i < pts.length; i++) {
      var p0 = pts[i - 1];
      var p1 = pts[i];
      var dx = (p1.x - p0.x) / 3;
      d += 'C' + (p0.x + dx).toFixed(1) + ',' + (p0.y + m[i - 1] * dx).toFixed(1) +
           ' ' + (p1.x - dx).toFixed(1) + ',' + (p1.y - m[i] * dx).toFixed(1) +
           ' ' + p1.x.toFixed(1) + ',' + p1.y.toFixed(1);
    }
    return d;
  }

  var uid = 'hw' + cfg[0];
  var main = series(cfg[0], cfg[1], cfg[2]);
  var line = path(main);
  var area = line + 'L' + W + ',' + H + 'L0,' + H + 'Z';

  /* The sparse accent series renders as DOTS, not a second line. Two lines at
     different densities read as two competing datasets; dots read as
     highlights on the one that is there. */
  var rand = rng(cfg[0] + 991);
  var dots = '';
  for (var i = 0; i < cfg[3]; i++) {
    var at = main[Math.floor(rand() * (main.length - 4)) + 2];
    dots += '<circle cx="' + at.x.toFixed(1) + '" cy="' + at.y.toFixed(1) +
            '" r="3.5" fill="#4ade80" opacity=".85"/>';
  }

  var svg =
    '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" aria-hidden="true" focusable="false">' +
      '<defs>' +
        '<linearGradient id="' + uid + 'f" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0" stop-color="#6366f1" stop-opacity=".26"/>' +
          '<stop offset="1" stop-color="#6366f1" stop-opacity="0"/>' +
        '</linearGradient>' +
        /* Fades the bleed into the page at both edges, so the wave ends
           because the page ends, not because the graphic stopped.

           WHITE, not black. An SVG mask is a LUMINANCE mask by default:
           white shows, black hides. Built with black stops it evaluates to
           zero luminance everywhere and silently erases the entire graphic —
           which is exactly what happened, and it looks identical to the
           script never having run. */
        '<linearGradient id="' + uid + 'm" x1="0" y1="0" x2="1" y2="0">' +
          '<stop offset="0" stop-color="#fff" stop-opacity="0"/>' +
          '<stop offset=".18" stop-color="#fff" stop-opacity="1"/>' +
          '<stop offset=".82" stop-color="#fff" stop-opacity="1"/>' +
          '<stop offset="1" stop-color="#fff" stop-opacity="0"/>' +
        '</linearGradient>' +
        '<mask id="' + uid + 'k"><rect width="' + W + '" height="' + H + '" fill="url(#' + uid + 'm)"/></mask>' +
      '</defs>' +
      '<g mask="url(#' + uid + 'k)">' +
        '<path d="' + area + '" fill="url(#' + uid + 'f)"/>' +
        '<path d="' + line + '" fill="none" stroke="#818cf8" stroke-width="2" ' +
          'stroke-linecap="round" vector-effect="non-scaling-stroke"/>' +
        dots +
      '</g>' +
    '</svg>';

  var el = document.createElement('div');
  el.className = 'dk-hero-wave';
  el.innerHTML = svg;

  /* First child, so it paints under the hero's own content. The hero is given
     `position: relative` in CSS for the same reason. */
  hero.insertBefore(el, hero.firstChild);

  /* Marks the hero as waved so the extra bottom padding applies ONLY where a
     wave was actually injected — a page whose preset is missing, or whose
     script failed to load, keeps its original spacing rather than opening on
     an unexplained gap. */
  hero.setAttribute('data-waved', '');
})();
