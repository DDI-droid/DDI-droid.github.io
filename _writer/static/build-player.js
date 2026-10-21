/* Stepped figures: <div class="plm-build" data-base="/path/name" data-n="5" data-alt="...">
   shows name-1.png ... name-5.png with previous / play / next controls, dots and arrow keys.
   initBuilds(root) sets up any figure not yet set up, so it can run after every preview update. */
(function () {
  function setup(el) {
    if (el.getAttribute('data-ready')) return;
    el.setAttribute('data-ready', '1');
    var base = el.getAttribute('data-base'), n = parseInt(el.getAttribute('data-n'), 10), alt = el.getAttribute('data-alt') || '';
    var i = 0, timer = null;
    var img = document.createElement('img'); img.className = 'plm-frame'; img.alt = alt; img.loading = 'lazy';
    var bar = document.createElement('div'); bar.className = 'plm-bar';
    var prev = document.createElement('button'); prev.textContent = '◀'; prev.title = 'previous step';
    var play = document.createElement('button'); play.textContent = 'Play';
    var next = document.createElement('button'); next.textContent = '▶'; next.title = 'next step';
    var dots = document.createElement('div'); dots.className = 'plm-dots';
    var count = document.createElement('span'); count.className = 'plm-count';
    var dotEls = [];
    for (var k = 0; k < n; k++) (function (k) {
      var d = document.createElement('span'); d.className = 'plm-dot';
      d.addEventListener('click', function () { stop(); show(k); });
      dots.appendChild(d); dotEls.push(d);
    })(k);
    bar.appendChild(prev); bar.appendChild(play); bar.appendChild(next); bar.appendChild(dots); bar.appendChild(count);
    el.appendChild(img); el.appendChild(bar); el.tabIndex = 0;
    for (var p = 1; p <= n; p++) { var pre = new Image(); pre.src = base + '-' + p + '.png'; }
    function show(k) {
      i = Math.max(0, Math.min(n - 1, k)); img.src = base + '-' + (i + 1) + '.png';
      prev.disabled = i === 0; next.disabled = i === n - 1; count.textContent = 'step ' + (i + 1) + ' of ' + n;
      for (var j = 0; j < n; j++) dotEls[j].className = 'plm-dot' + (j === i ? ' on' : '');
    }
    function stop() { if (timer) { clearInterval(timer); timer = null; } play.textContent = 'Play'; }
    function start() {
      if (i === n - 1) show(0);
      play.textContent = 'Pause';
      timer = setInterval(function () { if (i >= n - 1) { stop(); return; } show(i + 1); }, 1500);
    }
    prev.addEventListener('click', function () { stop(); show(i - 1); });
    next.addEventListener('click', function () { stop(); show(i + 1); });
    play.addEventListener('click', function () { timer ? stop() : start(); });
    img.addEventListener('click', function () { stop(); show(i === n - 1 ? 0 : i + 1); });
    el.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight') { stop(); show(i + 1); e.preventDefault(); }
      else if (e.key === 'ArrowLeft') { stop(); show(i - 1); e.preventDefault(); }
      else if (e.key === ' ') { timer ? stop() : start(); e.preventDefault(); }
    });
    show(0);
  }
  window.initBuilds = function (root) {
    var els = (root || document).querySelectorAll('.plm-build');
    for (var k = 0; k < els.length; k++) setup(els[k]);
  };
  if (document.readyState !== 'loading') window.initBuilds(); else document.addEventListener('DOMContentLoaded', function () { window.initBuilds(); });
})();
