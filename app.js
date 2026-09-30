/* groove lab v0.1: step sequencer, metronome and tempo ladder.
   All sounds are synthesised with the Web Audio API. Timing uses a lookahead
   scheduler: a setTimeout loop that books notes slightly ahead on the audio clock. */
(function () {
  'use strict';

  var DRUMS = [
    { id: 'kick', name: 'kick' },
    { id: 'snare', name: 'snare' },
    { id: 'hat', name: 'hi-hat' },
    { id: 'ride', name: 'ride' },
    { id: 'tom1', name: 'high tom' },
    { id: 'tom2', name: 'low tom' }
  ];
  var STEPS = 16;
  var LOOKAHEAD_MS = 25;
  var AHEAD_S = 0.1;
  var STORE = 'groove-lab';

  // rows in DRUMS order; each row is sixteen 0/1 steps
  function rowFrom(list) { var r = new Array(STEPS).fill(0); list.forEach(function (i) { r[i] = 1; }); return r; }
  var PRESETS = [
    { id: 'rock', name: 'basic rock', tempo: 100, swing: 0, rows: [
      [0, 8, 10], [4, 12], [0, 2, 4, 6, 8, 10, 12, 14], [], [], [] ] },
    { id: 'shuffle', name: 'half-time shuffle feel', tempo: 76, swing: 50, rows: [
      [0, 3, 10], [8], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], [], [], [] ] },
    { id: 'teentaal', name: 'teentaal on kit', tempo: 50, swing: 0, rows: [
      // dha on kick, dhin on low tom, tin and ta on high tom, ride marks sam, hi-hat marks khali
      [0, 3, 4, 7, 15], [], [8], [0], [9, 10, 11, 12], [1, 2, 5, 6, 13, 14] ] },
    { id: 'bossa', name: 'bossa-ish', tempo: 120, swing: 0, rows: [
      [0, 3, 4, 7, 8, 11, 12, 15], [0, 3, 6, 10, 13], [4, 12], [0, 2, 4, 6, 8, 10, 12, 14], [], [] ] }
  ].map(function (p) { p.rows = p.rows.map(rowFrom); return p; });

  // groups: beats that start a group get a lighter accent
  var SIGS = [
    { id: '3/4', beats: 3, unit: 'quarter', groups: [] },
    { id: '4/4', beats: 4, unit: 'quarter', groups: [] },
    { id: '5/4', beats: 5, unit: 'quarter', groups: [3] },
    { id: '7/8', beats: 7, unit: 'eighth', groups: [2, 4] }
  ];
  var SUBS = [
    { id: 1, name: 'quarter' }, { id: 2, name: 'eighth' },
    { id: 3, name: 'triplet' }, { id: 4, name: 'sixteenth' }
  ];

  var state = {
    mode: 'groove',
    tempo: 100,
    swing: 0,
    rows: PRESETS[0].rows.map(function (r) { return r.slice(); }),
    preset: 'rock',
    sig: '4/4',
    sub: 1,
    accentOne: true,
    ladder: { on: false, start: 80, step: 4, every: 4, ceil: 120 }
  };

  var run = { playing: false, timer: null, next: 0, idx: 0, bars: 0, queue: [], raf: 0, shown: -1, beatShown: -1 };
  var ctx = null, master = null, noise = null;

  function $(id) { return document.getElementById(id); }
  function clamp(n, lo, hi) { n = Math.round(Number(n)); if (!isFinite(n)) n = lo; return Math.max(lo, Math.min(hi, n)); }

  /* ---------- audio ---------- */
  function ensureAudio() {
    if (!ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      var comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -10; comp.ratio.value = 4;
      master = ctx.createGain(); master.gain.value = 0.8;
      master.connect(comp); comp.connect(ctx.destination);
      var len = ctx.sampleRate;
      noise = ctx.createBuffer(1, len, ctx.sampleRate);
      var d = noise.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function env(t, peak, decay) {
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    g.connect(master);
    return g;
  }
  function osc(type, f0, f1, t, dur, dest) {
    var o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.5);
    o.connect(dest); o.start(t); o.stop(t + dur + 0.02);
  }
  function noiseHit(t, dur, dest, filterType, freq) {
    var s = ctx.createBufferSource(); s.buffer = noise;
    var f = ctx.createBiquadFilter(); f.type = filterType; f.frequency.value = freq;
    s.connect(f); f.connect(dest); s.start(t); s.stop(t + dur + 0.02);
  }
  // six detuned squares through a high-pass: the classic drum-machine cymbal
  function metal(t, dur, dest, fund) {
    var hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7000;
    hp.connect(dest);
    [2, 3, 4.16, 5.43, 6.79, 8.21].forEach(function (r) {
      var o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = fund * r;
      o.connect(hp); o.start(t); o.stop(t + dur + 0.02);
    });
  }
  var VOICE = {
    kick: function (t) { osc('sine', 150, 42, t, 0.45, env(t, 1, 0.45)); },
    snare: function (t) {
      noiseHit(t, 0.2, env(t, 0.55, 0.2), 'highpass', 1200);
      osc('triangle', 190, 160, t, 0.12, env(t, 0.5, 0.12));
    },
    hat: function (t) { metal(t, 0.06, env(t, 0.25, 0.06), 40); },
    ride: function (t) {
      metal(t, 0.9, env(t, 0.12, 0.9), 52);
      osc('sine', 2900, null, t, 0.5, env(t, 0.04, 0.5));
    },
    tom1: function (t) { osc('sine', 240, 170, t, 0.35, env(t, 0.8, 0.35)); },
    tom2: function (t) { osc('sine', 150, 100, t, 0.45, env(t, 0.85, 0.45)); },
    // level 3 beat one, 2 group start, 1 beat, 0 subdivision
    click: function (t, level) {
      var f = [700, 1000, 1320, 1760][level];
      var p = [0.18, 0.4, 0.55, 0.75][level];
      osc('square', f, null, t, 0.03, env(t, p, 0.03));
    }
  };

  /* ---------- scheduler ---------- */
  function sig() { return SIGS.filter(function (s) { return s.id === state.sig; })[0] || SIGS[1]; }
  function beatLevel(s, beat) {
    if (beat === 0) return state.accentOne ? 3 : 1;
    return s.groups.indexOf(beat) >= 0 ? 2 : 1;
  }

  function scheduleOne() {
    var t = run.next, dur, i = run.idx;
    if (state.mode === 'groove') {
      dur = 60 / state.tempo / 4;
      var at = t + (i % 2 === 1 ? (state.swing / 100) * dur * (2 / 3) : 0);
      DRUMS.forEach(function (d, r) { if (state.rows[r][i]) VOICE[d.id](at); });
      run.queue.push({ kind: 'step', idx: i, time: at });
      run.next += dur;
      run.idx = (i + 1) % STEPS;
    } else {
      var s = sig(), per = state.sub, total = s.beats * per;
      dur = 60 / state.tempo / per;
      var beat = Math.floor(i / per), onBeat = i % per === 0;
      VOICE.click(t, onBeat ? beatLevel(s, beat) : 0);
      if (onBeat) run.queue.push({ kind: 'beat', idx: beat, time: t });
      run.next += dur;
      run.idx = (i + 1) % total;
    }
    if (run.idx === 0) barDone(run.next);
  }

  function barDone(time) {
    run.bars += 1;
    var L = state.ladder, climbed = false;
    if (L.on && run.bars % L.every === 0 && state.tempo < L.ceil) {
      state.tempo = Math.min(L.ceil, state.tempo + L.step);
      climbed = true;
    }
    run.queue.push({ kind: 'bar', bars: run.bars, climbed: climbed, time: time });
  }

  function tick() {
    if (!run.playing) return;
    while (run.next < ctx.currentTime + AHEAD_S) scheduleOne();
    run.timer = setTimeout(tick, LOOKAHEAD_MS);
  }

  function draw() {
    if (!run.playing) return;
    var now = ctx.currentTime;
    while (run.queue.length && run.queue[0].time <= now) {
      var ev = run.queue.shift();
      if (ev.kind === 'step') showStep(ev.idx);
      else if (ev.kind === 'beat') showBeat(ev.idx);
      else if (ev.kind === 'bar') {
        $('barNow').textContent = ev.bars;
        if (ev.climbed) { syncTempo(); save(); }
      }
    }
    run.raf = requestAnimationFrame(draw);
  }

  function play() {
    if (!ensureAudio()) { $('ladderNote').textContent = 'this browser cannot make sound here.'; return; }
    if (state.ladder.on) { state.tempo = state.ladder.start; syncTempo(); }
    run.playing = true; run.idx = 0; run.bars = 0; run.queue = [];
    run.next = ctx.currentTime + 0.06;
    $('barNow').textContent = '0';
    $('play').textContent = 'stop'; $('play').setAttribute('aria-pressed', 'true');
    tick();
    run.raf = requestAnimationFrame(draw);
  }
  function stop() {
    run.playing = false;
    clearTimeout(run.timer); cancelAnimationFrame(run.raf);
    run.queue = [];
    showStep(-1); showBeat(-1);
    $('play').textContent = 'play'; $('play').setAttribute('aria-pressed', 'false');
  }
  function toggle() { if (run.playing) stop(); else play(); }

  /* ---------- grid ---------- */
  var cells = []; // cells[row][step]
  function buildGrid() {
    var seq = $('seq');
    var nums = document.createElement('div');
    nums.className = 'track stepnums'; nums.setAttribute('aria-hidden', 'true');
    nums.appendChild(document.createElement('span'));
    var count = ['e', '&', 'a'];
    for (var s = 0; s < STEPS; s++) {
      var n = document.createElement('span');
      n.textContent = s % 4 === 0 ? String(s / 4 + 1) : count[s % 4 - 1];
      if (s % 4 === 0) n.className = 'downbeat';
      nums.appendChild(n);
    }
    seq.appendChild(nums);
    DRUMS.forEach(function (d, r) {
      var row = document.createElement('div');
      row.className = 'track'; row.setAttribute('role', 'group'); row.setAttribute('aria-label', d.name);
      var name = document.createElement('button');
      name.type = 'button'; name.className = 'drum'; name.textContent = d.name;
      name.setAttribute('aria-label', 'hear the ' + d.name);
      name.addEventListener('click', function () { if (ensureAudio()) VOICE[d.id](ctx.currentTime + 0.01); });
      row.appendChild(name);
      cells[r] = [];
      for (var s = 0; s < STEPS; s++) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'step' + (s % 4 === 0 ? ' downbeat' : '');
        b.setAttribute('aria-label', d.name + ', step ' + (s + 1));
        b.setAttribute('aria-pressed', 'false');
        b.setAttribute('tabindex', r === 0 && s === 0 ? '0' : '-1');
        b.dataset.r = r; b.dataset.s = s;
        row.appendChild(b);
        cells[r][s] = b;
      }
      seq.appendChild(row);
    });
    seq.addEventListener('click', function (e) {
      var b = e.target.closest('.step'); if (!b) return;
      var r = +b.dataset.r, s = +b.dataset.s;
      state.rows[r][s] = state.rows[r][s] ? 0 : 1;
      state.preset = null;
      focusCell(r, s, false);
      paintGrid(); changed();
    });
    seq.addEventListener('keydown', function (e) {
      var b = e.target.closest('.step'); if (!b) return;
      var r = +b.dataset.r, s = +b.dataset.s, handled = true;
      if (e.key === 'ArrowRight') s = (s + 1) % STEPS;
      else if (e.key === 'ArrowLeft') s = (s + STEPS - 1) % STEPS;
      else if (e.key === 'ArrowDown') r = (r + 1) % DRUMS.length;
      else if (e.key === 'ArrowUp') r = (r + DRUMS.length - 1) % DRUMS.length;
      else if (e.key === 'Home') s = 0;
      else if (e.key === 'End') s = STEPS - 1;
      else handled = false;
      if (handled) { e.preventDefault(); focusCell(r, s, true); }
    });
  }
  function focusCell(r, s, move) {
    cells.forEach(function (row) { row.forEach(function (c) { c.setAttribute('tabindex', '-1'); }); });
    cells[r][s].setAttribute('tabindex', '0');
    if (move) cells[r][s].focus();
  }
  function paintGrid() {
    DRUMS.forEach(function (d, r) {
      for (var s = 0; s < STEPS; s++) cells[r][s].setAttribute('aria-pressed', state.rows[r][s] ? 'true' : 'false');
    });
    document.querySelectorAll('#presets .pill').forEach(function (p) {
      p.setAttribute('aria-pressed', p.dataset.id === state.preset ? 'true' : 'false');
    });
  }
  function showStep(i) {
    if (run.shown === i) return;
    if (run.shown >= 0) cells.forEach(function (row) { row[run.shown].classList.remove('now'); });
    if (i >= 0) cells.forEach(function (row) { row[i].classList.add('now'); });
    run.shown = i;
  }

  /* ---------- metronome ui ---------- */
  function buildMetro() {
    SIGS.forEach(function (s) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'pill'; b.textContent = s.id; b.dataset.sig = s.id;
      b.addEventListener('click', function () { state.sig = s.id; if (run.playing && state.mode === 'metro') run.idx = 0; paintMetro(); changed(); });
      $('sigs').appendChild(b);
    });
    SUBS.forEach(function (s) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'pill'; b.textContent = s.name; b.dataset.sub = s.id;
      b.addEventListener('click', function () { state.sub = s.id; if (run.playing && state.mode === 'metro') run.idx = 0; paintMetro(); changed(); });
      $('subs').appendChild(b);
    });
    $('accentOne').addEventListener('change', function (e) { state.accentOne = e.target.checked; paintMetro(); changed(); });
  }
  function paintMetro() {
    var s = sig();
    document.querySelectorAll('#sigs .pill').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.sig === state.sig ? 'true' : 'false'); });
    document.querySelectorAll('#subs .pill').forEach(function (b) { b.setAttribute('aria-pressed', +b.dataset.sub === state.sub ? 'true' : 'false'); });
    $('accentOne').checked = state.accentOne;
    var subName = SUBS.filter(function (x) { return x.id === state.sub; })[0].name;
    $('metroMeta').textContent = s.id + ' · ' + subName;
    $('sigNote').textContent = s.unit === 'eighth'
      ? 'in 7/8 the beat is the eighth note, grouped 2 + 2 + 3. the subdivision splits each eighth.'
      : 'the beat is the quarter note.';
    var box = $('beats');
    box.textContent = '';
    for (var i = 0; i < s.beats; i++) {
      var d = document.createElement('span');
      d.className = 'beat' + (beatLevel(s, i) > 1 ? ' accent' : '');
      d.textContent = i + 1;
      box.appendChild(d);
    }
    run.beatShown = -1;
  }
  function showBeat(i) {
    var dots = $('beats').children;
    if (run.beatShown >= 0 && dots[run.beatShown]) dots[run.beatShown].classList.remove('now');
    if (i >= 0 && dots[i]) dots[i].classList.add('now');
    run.beatShown = i;
  }

  /* ---------- tempo, swing, ladder ---------- */
  function syncTempo() {
    $('tempo').value = state.tempo; $('tempoRange').value = state.tempo;
    $('bpmNow').textContent = state.tempo;
  }
  function setTempo(v) { state.tempo = clamp(v, 40, 240); syncTempo(); changed(); }
  function syncSwing() { $('swing').value = state.swing; $('swingOut').textContent = state.swing + '%'; }
  function syncLadder() {
    var L = state.ladder;
    $('ladderOn').checked = L.on;
    $('ladStart').value = L.start; $('ladStep').value = L.step; $('ladEvery').value = L.every; $('ladCeil').value = L.ceil;
    $('ladderNote').textContent = L.on
      ? 'starts at ' + L.start + ', adds ' + L.step + ' every ' + L.every + (L.every === 1 ? ' bar' : ' bars') + ', stops climbing at ' + L.ceil + '.'
      : 'off. the tempo stays where you set it.';
  }
  function readLadder() {
    var L = state.ladder;
    L.on = $('ladderOn').checked;
    L.start = clamp($('ladStart').value, 40, 240);
    L.step = clamp($('ladStep').value, 1, 40);
    L.every = clamp($('ladEvery').value, 1, 32);
    L.ceil = clamp($('ladCeil').value, L.start, 240);
  }

  /* ---------- share: #g=<24 hex, 4 per row>&t=<bpm>&s=<swing> ---------- */
  function encode() {
    var hex = state.rows.map(function (row) {
      var n = 0;
      for (var s = 0; s < STEPS; s++) if (row[s]) n |= (1 << (15 - s));
      return ('000' + n.toString(16)).slice(-4);
    }).join('');
    return 'g=' + hex + '&t=' + state.tempo + '&s=' + state.swing;
  }
  function decode(hash) {
    var h = String(hash || '').replace(/^#/, '');
    if (!h) return false;
    var p = {};
    h.split('&').forEach(function (kv) { var i = kv.indexOf('='); if (i > 0) p[kv.slice(0, i)] = kv.slice(i + 1); });
    if (!/^[0-9a-fA-F]{24}$/.test(p.g || '')) return false;
    var rows = [];
    for (var r = 0; r < DRUMS.length; r++) {
      var n = parseInt(p.g.slice(r * 4, r * 4 + 4), 16), row = [];
      for (var s = 0; s < STEPS; s++) row.push((n >> (15 - s)) & 1);
      rows.push(row);
    }
    state.rows = rows;
    if (p.t) state.tempo = clamp(p.t, 40, 240);
    if (p.s) state.swing = clamp(p.s, 0, 60);
    state.preset = matchPreset();
    return true;
  }
  function matchPreset() {
    var cur = JSON.stringify(state.rows);
    var m = PRESETS.filter(function (p) { return JSON.stringify(p.rows) === cur; })[0];
    return m ? m.id : null;
  }
  function shareUrl() { return location.href.split('#')[0] + '#' + encode(); }

  function copyLink() {
    var url = shareUrl(), status = $('copyStatus');
    function fallback() {
      var box = $('linkbox');
      box.hidden = false; box.value = url; box.focus(); box.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) {}
      status.textContent = ok ? 'link copied.' : 'copy the link from the box below.';
    }
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(url).then(function () { status.textContent = 'link copied. it carries the pattern, tempo and swing.'; }, fallback);
    } else fallback();
  }

  /* ---------- persistence ---------- */
  function save() {
    try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (e) {}
  }
  function load() {
    try {
      var s = JSON.parse(localStorage.getItem(STORE) || 'null');
      if (!s || !Array.isArray(s.rows) || s.rows.length !== DRUMS.length) return false;
      state.rows = s.rows.map(function (r) {
        var out = [];
        for (var i = 0; i < STEPS; i++) out.push(r && r[i] ? 1 : 0);
        return out;
      });
      state.tempo = clamp(s.tempo, 40, 240); state.swing = clamp(s.swing, 0, 60);
      if (SIGS.some(function (x) { return x.id === s.sig; })) state.sig = s.sig;
      if ([1, 2, 3, 4].indexOf(s.sub) >= 0) state.sub = s.sub;
      state.accentOne = s.accentOne !== false;
      state.mode = s.mode === 'metro' ? 'metro' : 'groove';
      if (s.ladder) {
        var st = clamp(s.ladder.start, 40, 240);
        state.ladder = {
          on: !!s.ladder.on, start: st, step: clamp(s.ladder.step, 1, 40),
          every: clamp(s.ladder.every, 1, 32), ceil: clamp(s.ladder.ceil, st, 240)
        };
      }
      state.preset = matchPreset();
      return true;
    } catch (e) { return false; }
  }
  function writeHash() {
    try { history.replaceState(null, '', '#' + encode()); } catch (e) { location.hash = encode(); }
  }
  function changed() { writeHash(); save(); }

  function setMode(m) {
    var wasPlaying = run.playing;
    if (wasPlaying) stop();
    state.mode = m;
    document.querySelectorAll('.modes .pill').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.mode === m ? 'true' : 'false'); });
    $('groovePanel').hidden = m !== 'groove';
    $('metroPanel').hidden = m !== 'metro';
    $('swingSet').hidden = m !== 'groove';
    save();
    if (wasPlaying) play();
  }

  /* ---------- wire up ---------- */
  function init() {
    buildGrid();
    buildMetro();
    PRESETS.forEach(function (p) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'pill'; b.textContent = p.name; b.dataset.id = p.id;
      b.addEventListener('click', function () {
        state.rows = p.rows.map(function (r) { return r.slice(); });
        state.tempo = p.tempo; state.swing = p.swing; state.preset = p.id;
        syncTempo(); syncSwing(); paintGrid(); changed();
      });
      $('presets').appendChild(b);
    });

    $('play').addEventListener('click', toggle);
    $('tempo').addEventListener('change', function (e) { setTempo(e.target.value); });
    $('tempoRange').addEventListener('input', function (e) { setTempo(e.target.value); });
    $('swing').addEventListener('input', function (e) { state.swing = clamp(e.target.value, 0, 60); syncSwing(); changed(); });
    ['ladderOn', 'ladStart', 'ladStep', 'ladEvery', 'ladCeil'].forEach(function (id) {
      $(id).addEventListener('change', function () { readLadder(); syncLadder(); save(); });
    });
    $('copy').addEventListener('click', copyLink);
    $('clear').addEventListener('click', function () {
      state.rows = DRUMS.map(function () { return new Array(STEPS).fill(0); });
      state.preset = null; paintGrid(); changed();
      $('copyStatus').textContent = 'the grid is empty. tap a square to add a hit.';
    });
    document.querySelectorAll('.modes .pill').forEach(function (b) {
      b.addEventListener('click', function () { setMode(b.dataset.mode); });
    });

    // space plays and stops, except where space types or ticks a box
    function spaceKey(e) {
      if (!(e.code === 'Space' || e.key === ' ')) return false;
      var t = e.target, tag = t.tagName;
      if (tag === 'TEXTAREA' || tag === 'SELECT') return false;
      if (tag === 'INPUT' && t.type !== 'range') return false;
      return true;
    }
    document.addEventListener('keydown', function (e) {
      if (!spaceKey(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      e.preventDefault();
      if (!e.repeat) toggle();
    });
    document.addEventListener('keyup', function (e) { if (spaceKey(e)) e.preventDefault(); });

    $('theme').addEventListener('click', function () {
      var root = document.documentElement;
      var dark = root.getAttribute('data-theme') === 'dark' ||
        (!root.getAttribute('data-theme') && window.matchMedia('(prefers-color-scheme: dark)').matches);
      var next = dark ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem('theme', next); } catch (e) {}
    });

    window.addEventListener('hashchange', function () {
      if (decode(location.hash)) { syncTempo(); syncSwing(); paintGrid(); save(); }
    });

    // precedence: a shared link, then this browser's last session, then basic rock.
    // a link sets the groove; this browser keeps its own metronome and ladder settings.
    var hadHash = !!location.hash.replace(/^#/, '');
    var hash = location.hash;
    var had = load();
    var fromHash = decode(hash);
    if (fromHash) state.mode = 'groove';
    syncTempo(); syncSwing(); syncLadder(); paintGrid(); paintMetro(); setMode(state.mode);
    if (hadHash && !fromHash) $('copyStatus').textContent = had ? 'that link could not be read, so this is your last groove.' : 'that link could not be read, so this is basic rock.';
    writeHash();
  }

  init();

  // test and debugging hooks
  window.grooveLab = {
    state: state,
    isPlaying: function () { return run.playing; },
    audioState: function () { return ctx ? ctx.state : 'none'; },
    bars: function () { return run.bars; },
    encode: encode
  };
})();
