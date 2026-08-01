/* =========================================================
   오늘의 꽃 카드뽑기
   1) 전체 꽃 이미지에서 랜덤으로 N장을 뽑아 뒷면으로 깔기
   2) 시청자가 부른 번호의 카드를 뒤집어 공개
   3) 카드를 섞은 뒤 그중 한 장을 뽑기
   ========================================================= */

(function () {
  'use strict';

  /* ---------------- 기본 설정 ---------------- */
  const ASPECT = 1.34;    // 카드 세로/가로 비율
  const GAP = 18;         // 카드 사이 간격(px)

  const NAMES = window.FLOWER_NAMES || {};

  const POOL = (window.FLOWER_IMAGES || []).map(function (name) {
    return { src: 'images/' + name, name: NAMES[name] || '' };
  });

  const state = {
    stage: 'idle',      // idle | dealt | shuffled | picked
    count: 8,
    cards: [],          // 슬롯 순서대로 담긴 카드 객체 배열
    busy: false,
    sound: true,
    speed: 1,
    showNumbers: true,
    faceUpStart: true,  // 처음 카드를 그림면으로 펼칠지
    layout: null,
    slots: []
  };

  /* ---------------- DOM ---------------- */
  const $ = function (id) { return document.getElementById(id); };

  const board = $('board');
  const stageEl = $('stage');
  const deckPile = $('deckPile');
  const veil = $('veil');
  const numpad = $('numpad');
  const hint = $('hint');
  const steps = $('steps');

  const btnDeal = $('btnDeal');
  const btnRevealAll = $('btnRevealAll');
  const btnShuffle = $('btnShuffle');
  const btnPick = $('btnPick');
  const btnReset = $('btnReset');
  const btnSound = $('btnSound');
  const btnSettings = $('btnSettings');
  const settingsPanel = $('settingsPanel');
  const selCount = $('selCount');
  const selFace = $('selFace');
  const selSpeed = $('selSpeed');
  const chkNumbers = $('chkNumbers');

  $('poolCount').textContent = POOL.length;
  $('deckCount').textContent = state.count;

  /* ---------------- 유틸 ---------------- */
  const sleep = function (ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  };

  const rand = function (a, b) { return a + Math.random() * (b - a); };

  function say(text) {
    hint.classList.remove('win');
    hint.innerHTML = '<span></span>';
    hint.firstChild.textContent = text;
  }

  function sayWin(card) {
    hint.classList.add('win');
    const span = document.createElement('span');
    span.appendChild(document.createTextNode('오늘의 꽃은 '));
    const b = document.createElement('b');
    b.textContent = card.no + '번';
    span.appendChild(b);
    if (card.flowerName) {
      const nm = document.createElement('b');
      nm.className = 'win-name';
      nm.textContent = card.flowerName;
      span.appendChild(document.createTextNode(' · '));
      span.appendChild(nm);
    }
    span.appendChild(document.createTextNode(card.flowerName ? '!' : ' 카드!'));
    hint.classList.remove('win');
    hint.innerHTML = '';
    hint.appendChild(span);
    hint.classList.add('win');
  }

  function shuffleArray(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function pickRandom(arr, n) {
    return shuffleArray(arr).slice(0, n);
  }

  /* 이미지가 다 뜬 뒤에 카드를 펼치도록 (그림면으로 시작할 때 빈 카드 방지) */
  function preload(srcs, timeoutMs) {
    return new Promise(function (resolve) {
      let left = srcs.length;
      if (!left) return resolve();
      const done = function () { if (--left <= 0) resolve(); };
      srcs.forEach(function (s) {
        const im = new Image();
        im.onload = done;
        im.onerror = done;
        im.src = s;
      });
      setTimeout(resolve, timeoutMs || 2500);
    });
  }

  /* =========================================================
     사운드 (외부 파일 없이 WebAudio 로 생성)
     ========================================================= */
  const Sound = (function () {
    let ctx = null;
    let noiseBuf = null;

    function ac() {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        ctx = new AC();
      }
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    }

    function noise() {
      const c = ac();
      if (!c) return null;
      if (!noiseBuf) {
        const len = c.sampleRate * 0.5;
        noiseBuf = c.createBuffer(1, len, c.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      }
      return noiseBuf;
    }

    function tone(freq, dur, type, vol, delay) {
      if (!state.sound) return;
      const c = ac();
      if (!c) return;
      const t0 = c.currentTime + (delay || 0);
      const osc = c.createOscillator();
      const g = c.createGain();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, t0);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol || 0.14, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g).connect(c.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.05);
    }

    function swish(delay, vol) {
      if (!state.sound) return;
      const c = ac();
      const buf = noise();
      if (!c || !buf) return;
      const t0 = c.currentTime + (delay || 0);
      const src = c.createBufferSource();
      src.buffer = buf;
      const flt = c.createBiquadFilter();
      flt.type = 'bandpass';
      flt.frequency.setValueAtTime(900, t0);
      flt.frequency.exponentialRampToValueAtTime(3200, t0 + 0.16);
      flt.Q.value = 1.1;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol || 0.1, t0 + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.2);
      src.connect(flt).connect(g).connect(c.destination);
      src.start(t0);
      src.stop(t0 + 0.3);
    }

    return {
      deal: function (i) { swish(i * 0.02, 0.07); tone(520 + i * 18, 0.1, 'triangle', 0.05, i * 0.02); },
      flip: function () { tone(660, 0.09, 'triangle', 0.10); tone(990, 0.16, 'sine', 0.09, 0.06); },
      shuffle: function (d) { swish(d, 0.12); },
      tick: function () { tone(1180, 0.045, 'square', 0.045); },
      pop: function () { tone(880, 0.08, 'sine', 0.10); },
      fanfare: function () {
        const mel = [
          [523.25, 0.00], [659.25, 0.11], [783.99, 0.22],
          [1046.5, 0.34], [987.77, 0.50], [1046.5, 0.60]
        ];
        mel.forEach(function (m, i) {
          tone(m[0], i === mel.length - 1 ? 0.7 : 0.26, 'triangle', 0.13, m[1]);
          tone(m[0] * 2, 0.18, 'sine', 0.05, m[1] + 0.01);
        });
      },
      unlock: function () { ac(); }
    };
  })();

  /* =========================================================
     파티클 (꽃잎 / 반짝임)
     ========================================================= */
  const FX = (function () {
    const cv = $('fx');
    const cx = cv.getContext('2d');
    let parts = [];
    let raf = null;
    let dpr = 1;

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      cv.width = Math.floor(window.innerWidth * dpr);
      cv.height = Math.floor(window.innerHeight * dpr);
      cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    window.addEventListener('resize', resize);

    const PETAL = ['#f4a3b8', '#f7c7d4', '#ffd98a', '#a8dcb5', '#ffffff', '#ef8fa8', '#cdebd3'];

    function spawn(x, y, n, opt) {
      opt = opt || {};
      const power = opt.power || 1;
      for (let i = 0; i < n; i++) {
        const a = opt.angle != null ? opt.angle + rand(-0.9, 0.9) : rand(0, Math.PI * 2);
        const sp = rand(2, 9) * power;
        parts.push({
          x: x, y: y,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp - rand(1, 5) * power,
          g: rand(0.10, 0.24),
          w: rand(6, 15) * (opt.scale || 1),
          h: rand(4, 10) * (opt.scale || 1),
          rot: rand(0, Math.PI * 2),
          vr: rand(-0.16, 0.16),
          life: rand(70, 150),
          age: 0,
          c: PETAL[Math.floor(Math.random() * PETAL.length)],
          sparkle: !!opt.sparkle
        });
      }
      start();
    }

    function rain(ms) {
      const t0 = performance.now();
      (function step() {
        if (performance.now() - t0 > ms) return;
        for (let i = 0; i < 3; i++) {
          parts.push({
            x: rand(0, window.innerWidth), y: -20,
            vx: rand(-1.2, 1.2), vy: rand(1.2, 3.2), g: 0.02,
            w: rand(7, 16), h: rand(5, 11),
            rot: rand(0, 6.28), vr: rand(-0.09, 0.09),
            life: 320, age: 0,
            c: PETAL[Math.floor(Math.random() * PETAL.length)],
            sway: rand(0.01, 0.04), phase: rand(0, 6.28)
          });
        }
        start();
        setTimeout(step, 55);
      })();
    }

    function frame() {
      cx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.age++;
        if (p.sway) p.x += Math.sin((p.age * p.sway) + p.phase) * 1.1;
        p.x += p.vx;
        p.y += p.vy;
        p.vy += p.g;
        p.vx *= 0.992;
        p.rot += p.vr;

        const alpha = Math.max(0, 1 - p.age / p.life);
        if (alpha <= 0 || p.y > window.innerHeight + 60) { parts.splice(i, 1); continue; }

        cx.save();
        cx.globalAlpha = alpha;
        cx.translate(p.x, p.y);
        cx.rotate(p.rot);
        cx.fillStyle = p.c;
        if (p.sparkle) {
          cx.beginPath();
          const r = p.w / 2;
          for (let k = 0; k < 4; k++) {
            const a1 = (Math.PI / 2) * k;
            cx.lineTo(Math.cos(a1) * r, Math.sin(a1) * r);
            cx.lineTo(Math.cos(a1 + Math.PI / 4) * r * 0.3, Math.sin(a1 + Math.PI / 4) * r * 0.3);
          }
          cx.closePath();
          cx.fill();
        } else {
          cx.beginPath();
          cx.ellipse(0, 0, p.w / 2, p.h / 2, 0, 0, Math.PI * 2);
          cx.fill();
        }
        cx.restore();
      }
      if (parts.length) {
        raf = requestAnimationFrame(frame);
      } else {
        raf = null;
        cx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      }
    }

    function start() { if (!raf) raf = requestAnimationFrame(frame); }

    function clear() { parts = []; }

    return { spawn: spawn, rain: rain, clear: clear };
  })();

  /* =========================================================
     카드 배치 계산
     ========================================================= */
  function computeLayout(n, W, H) {
    let best = null;
    for (let cols = 1; cols <= n; cols++) {
      const rows = Math.ceil(n / cols);
      let cw = (W - GAP * (cols + 1)) / cols;
      let ch = cw * ASPECT;
      if (ch * rows + GAP * (rows + 1) > H) {
        ch = (H - GAP * (rows + 1)) / rows;
        cw = ch / ASPECT;
      }
      if (cw <= 20 || ch <= 20) continue;
      // 빈 자리가 생기는 배치(예: 6+2)는 살짝 감점해서 반듯한 격자를 선호
      const waste = cols * rows - n;
      const score = cw * ch * (1 - 0.04 * waste);
      if (!best || score > best.score) best = { cols: cols, rows: rows, cw: cw, ch: ch, score: score };
    }
    return best || { cols: n, rows: 1, cw: 60, ch: 84, score: 1 };
  }

  function computeSlots(n, L, W, H) {
    const slots = [];
    const totalH = L.rows * L.ch + GAP * (L.rows - 1);
    const startY = (H - totalH) / 2;
    for (let i = 0; i < n; i++) {
      const row = Math.floor(i / L.cols);
      const inRow = Math.min(L.cols, n - row * L.cols);
      const totalW = inRow * L.cw + GAP * (inRow - 1);
      const startX = (W - totalW) / 2;
      const col = i - row * L.cols;
      slots.push({
        x: startX + col * (L.cw + GAP),
        y: startY + row * (L.ch + GAP)
      });
    }
    return slots;
  }

  function boardSize() {
    const r = board.getBoundingClientRect();
    return { w: r.width, h: r.height };
  }

  function recalc() {
    const s = boardSize();
    state.layout = computeLayout(state.count, s.w, s.h);
    state.slots = computeSlots(state.count, state.layout, s.w, s.h);
  }

  /* =========================================================
     카드 생성 / 트랜스폼
     ========================================================= */
  function tf(x, y, scale, rot) {
    return 'translate3d(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px,0)'
      + ' rotate(' + (rot || 0).toFixed(2) + 'deg)'
      + ' scale(' + (scale == null ? 1 : scale).toFixed(3) + ')';
  }

  function setTransition(card, ms, ease) {
    card.el.style.transition = ms > 0
      ? 'transform ' + ms + 'ms ' + (ease || 'cubic-bezier(.22,1,.36,1)') + ', opacity 260ms ease'
      : 'none';
  }

  function place(card, slotIndex, opt) {
    opt = opt || {};
    const s = state.slots[slotIndex];
    card.el.style.transform = tf(s.x, s.y, opt.scale, opt.rot);
  }

  function makeCard(item) {
    const src = item.src;
    const el = document.createElement('div');
    el.className = 'card dealing' + (state.faceUpStart ? ' revealed' : '');
    el.innerHTML =
      '<div class="card-inner">'
      + '<div class="card-face card-back">'
      + '<span class="card-num"></span>'
      + '<span class="back-art" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><b></b></span>'
      + '</div>'
      + '<div class="card-face card-front">'
      + '<div class="front-photo"><img alt="꽃 카드" draggable="false" /></div>'
      + '<div class="front-label"><span class="front-name"></span><span class="front-num"></span></div>'
      + '</div>'
      + '</div>';
    const img = el.querySelector('img');
    img.src = src;

    const nameEl = el.querySelector('.front-name');
    nameEl.textContent = item.name || '';
    if (!item.name) el.querySelector('.front-label').classList.add('no-name');

    const card = {
      el: el,
      src: src,
      flowerName: item.name || '',
      revealed: state.faceUpStart,
      toggled: false,
      num: el.querySelector('.card-num'),
      frontNum: el.querySelector('.front-num')
    };

    el.addEventListener('click', function () {
      if (state.busy) return;
      const idx = state.cards.indexOf(card);
      if (idx >= 0) toggleCard(idx);
    });

    board.appendChild(el);
    return card;
  }

  function applySizes() {
    const L = state.layout;
    state.cards.forEach(function (c) {
      c.el.style.width = L.cw + 'px';
      c.el.style.height = L.ch + 'px';
    });
  }

  /* 번호는 카드에 고정된 값(c.no). 섞어도 번호↔그림 짝은 바뀌지 않는다 */
  function paintNumbers() {
    state.cards.forEach(function (c) {
      c.num.textContent = String(c.no);
      c.frontNum.textContent = c.no + '번';
    });
  }

  function indexOfNo(no) {
    for (let i = 0; i < state.cards.length; i++) {
      if (state.cards[i].no === no) return i;
    }
    return -1;
  }

  function layoutAll(ms, stagger) {
    recalc();
    applySizes();
    paintNumbers();
    state.cards.forEach(function (c, i) {
      const d = (stagger || 0) * i;
      setTransition(c, ms, 'cubic-bezier(.22,1,.36,1)');
      c.el.style.transitionDelay = d + 'ms';
      place(c, i);
      setTimeout(function () { c.el.style.transitionDelay = '0ms'; }, ms + d + 20);
    });
  }

  /* =========================================================
     1단계 — 오늘의 카드 뽑기
     ========================================================= */
  async function deal() {
    if (state.busy) return;
    if (POOL.length < state.count) {
      say('꽃 이미지가 부족합니다. images 폴더를 확인해주세요.');
      return;
    }
    state.busy = true;
    Sound.unlock();
    FX.clear();
    veil.classList.remove('on');

    board.innerHTML = '';
    board.classList.remove('anon');
    state.cards = [];
    state.stage = 'idle';

    deckPile.classList.add('hidden');

    setStep(2);
    say('오늘의 꽃 ' + state.count + '장을 뽑고 있어요…');

    const chosen = pickRandom(POOL, state.count);
    if (state.faceUpStart) {
      await preload(chosen.map(function (c) { return c.src; }), 2500);
    }

    recalc();
    const s = boardSize();
    const L = state.layout;
    const deckX = s.w / 2 - L.cw / 2;
    const deckY = s.h / 2 - L.ch / 2;

    state.cards = chosen.map(function (item) { return makeCard(item); });
    state.cards.forEach(function (c, i) { c.no = i + 1; });   // 번호 확정 (이후 고정)
    applySizes();
    paintNumbers();

    // 카드 더미 위치에서 시작
    state.cards.forEach(function (c) {
      setTransition(c, 0);
      c.el.style.transform = tf(deckX, deckY, 0.55, rand(-12, 12));
      c.el.style.opacity = '0';
    });

    // 리플로우 강제
    void board.offsetHeight;

    const step = 105 * state.speed;
    state.cards.forEach(function (c, i) {
      setTimeout(function () {
        setTransition(c, 620 * state.speed, 'cubic-bezier(.18,.9,.28,1.12)');
        c.el.style.opacity = '1';
        c.el.classList.remove('dealing');
        place(c, i);
        Sound.deal(i);
      }, i * step);
    });

    await sleep(state.count * step + 700 * state.speed);

    state.stage = 'dealt';
    state.busy = false;
    buildNumpad();
    updateButtons();
    say(state.faceUpStart
      ? '오늘의 꽃 ' + state.count + '장입니다! 시청자가 부르는 번호를 누르면 그 카드가 뒤집힙니다.'
      : '시청자가 부르는 번호를 눌러 카드를 공개하세요. (숫자키도 가능)');
  }

  /* =========================================================
     2단계 — 번호를 부르면 그 카드를 뒤집기 (앞↔뒤 토글)
     ========================================================= */
  function canFlip() {
    return state.stage === 'dealt' || state.stage === 'shuffled';
  }

  /* to 를 주면 그 상태로, 안 주면 현재 상태의 반대로 뒤집는다 */
  function setFace(i, to) {
    const c = state.cards[i];
    if (!c) return false;
    const next = (to == null) ? !c.revealed : !!to;
    if (next === c.revealed) return false;

    c.revealed = next;
    c.el.classList.toggle('revealed', next);
    Sound.flip();

    // 살짝 튀어오르는 느낌
    const s = state.slots[i];
    if (s) {
      setTransition(c, 260 * state.speed, 'cubic-bezier(.3,1.5,.5,1)');
      c.el.style.transform = tf(s.x, s.y - 12, 1.05, 0);
      setTimeout(function () {
        setTransition(c, 380 * state.speed);
        c.el.style.transform = tf(s.x, s.y, 1, 0);
      }, 300 * state.speed);
    }

    // 그림이 나타날 때만 반짝임
    if (next) {
      const r = c.el.getBoundingClientRect();
      FX.spawn(r.left + r.width / 2, r.top + r.height / 2, 12, { power: 0.7, scale: 0.8, sparkle: true });
    }
    return true;
  }

  function toggleCard(i) {
    if (state.busy || !canFlip()) return;
    if (!setFace(i)) return;
    state.cards[i].toggled = true;
    markNumpad();
    updateButtons();
    reportFaces();
  }

  /* 번호(1~N)로 뒤집기 — 섞여서 자리가 바뀌어도 그 번호 카드를 찾아간다 */
  function toggleNo(no) {
    const i = indexOfNo(no);
    if (i >= 0) toggleCard(i);
  }

  function reportFaces() {
    const up = state.cards.filter(function (c) { return c.revealed; }).length;
    const down = state.cards.length - up;
    if (down === 0) {
      say('모두 그림면입니다 · 번호를 누르면 그 카드가 덮입니다.');
    } else if (up === 0) {
      say('모두 덮였습니다! 이제 “카드 섞기”를 눌러주세요.');
      btnShuffle.classList.add('pulse');
    } else {
      say('그림면 ' + up + '장 · 뒷면 ' + down + '장 — 번호를 눌러 뒤집으세요.');
    }
  }

  /* 한 장이라도 덮여 있으면 전부 공개, 다 열려 있으면 전부 덮기 */
  async function flipAll() {
    if (state.busy || !canFlip() || state.cards.length === 0) return;
    const target = state.cards.some(function (c) { return !c.revealed; });
    state.busy = true;
    updateButtons();
    for (let i = 0; i < state.cards.length; i++) {
      if (setFace(i, target)) await sleep(170 * state.speed);
    }
    state.busy = false;
    markNumpad();
    updateButtons();
    reportFaces();
  }

  /* =========================================================
     3단계 — 섞기
     ========================================================= */
  async function doShuffle() {
    if (state.busy || state.stage === 'idle') return;
    state.busy = true;
    btnShuffle.classList.remove('pulse');
    clearPickState(false);
    updateButtons();
    say('카드를 섞는 중…');

    // 섞은 뒤부터는 뒷면에 번호 대신 꽃 문양
    board.classList.add('anon');

    recalc();
    const s = boardSize();
    const L = state.layout;
    const cx = s.w / 2 - L.cw / 2;
    const cy = s.h / 2 - L.ch / 2;

    // (1) 전부 뒤집어 덮기
    state.cards.forEach(function (c) {
      c.revealed = false;
      c.el.classList.remove('revealed');
    });
    markNumpad();
    Sound.flip();
    await sleep(480 * state.speed);

    // (2) 가운데로 모으기
    state.cards.forEach(function (c, i) {
      setTransition(c, 420 * state.speed);
      c.el.style.transitionDelay = (i * 22) + 'ms';
      c.el.style.zIndex = String(10 + i);
      c.el.style.transform = tf(cx + rand(-10, 10), cy + rand(-6, 6), 0.94, rand(-7, 7));
    });
    Sound.shuffle(0);
    await sleep(520 * state.speed);
    state.cards.forEach(function (c) { c.el.style.transitionDelay = '0ms'; });

    // (3) 리플 셔플 (섞이는 느낌)
    for (let round = 0; round < 3; round++) {
      state.cards.forEach(function (c, i) {
        const dir = (i % 2 === 0) ? -1 : 1;
        setTransition(c, 190 * state.speed, 'cubic-bezier(.4,0,.4,1)');
        c.el.style.zIndex = String(10 + Math.floor(Math.random() * state.count));
        c.el.style.transform = tf(
          cx + dir * rand(30, L.cw * 0.55),
          cy + rand(-18, 18),
          0.92,
          dir * rand(4, 15)
        );
      });
      Sound.shuffle(0);
      await sleep(200 * state.speed);

      state.cards.forEach(function (c) {
        setTransition(c, 190 * state.speed, 'cubic-bezier(.4,0,.4,1)');
        c.el.style.transform = tf(cx + rand(-8, 8), cy + rand(-5, 5), 0.94, rand(-5, 5));
      });
      await sleep(200 * state.speed);
    }

    // (4) 자리만 섞는다. 번호·그림 짝은 그대로 유지
    state.cards = shuffleArray(state.cards);
    state.cards.forEach(function (c, i) {
      c.el.style.zIndex = String(10 + i);
      c.toggled = false;
    });

    state.cards.forEach(function (c, i) {
      setTransition(c, 560 * state.speed, 'cubic-bezier(.18,.9,.28,1.08)');
      c.el.style.transitionDelay = (i * 55) + 'ms';
      place(c, i);
      Sound.deal(i);
    });
    await sleep(560 * state.speed + state.count * 55 + 120);
    state.cards.forEach(function (c) { c.el.style.transitionDelay = '0ms'; });

    state.stage = 'shuffled';
    state.busy = false;
    setStep(3);
    buildNumpad();
    updateButtons();
    btnPick.classList.add('pulse');
    say('섞기 완료! “한 장 뽑기”를 눌러 오늘의 꽃을 뽑아주세요.');
  }

  /* =========================================================
     3단계 — 한 장 뽑기
     ========================================================= */
  async function pickOne() {
    if (state.busy || state.stage === 'idle' || state.cards.length === 0) return;
    state.busy = true;
    btnPick.classList.remove('pulse');
    FX.clear();
    recalc();

    // 직전 당첨 연출이 남아 있으면 원위치로 되돌리기
    const wasPicked = state.stage === 'picked';
    clearPickState(true);
    state.stage = 'shuffled';
    updateButtons();
    if (wasPicked) await sleep(460 * state.speed);

    // 공개된 카드가 있으면 먼저 덮기
    const anyOpen = state.cards.some(function (c) { return c.revealed; });
    if (anyOpen) {
      state.cards.forEach(function (c) {
        c.revealed = false;
        c.el.classList.remove('revealed');
      });
      markNumpad();
      Sound.flip();
      await sleep(520 * state.speed);
    }

    say('오늘의 꽃을 고르는 중…');
    veil.classList.add('on');
    state.cards.forEach(function (c) { c.el.classList.add('dimmed'); });
    await sleep(320);

    // 스포트라이트 순회
    const n = state.cards.length;
    const winnerIdx = Math.floor(Math.random() * n);
    const hops = n * 3 + 6 + winnerIdx;
    let cur = Math.floor(Math.random() * n);

    for (let k = 0; k < hops; k++) {
      state.cards.forEach(function (c) { c.el.classList.remove('spot'); });
      cur = (cur + 1) % n;
      const c = state.cards[cur];
      c.el.classList.add('spot');
      c.el.classList.remove('dimmed');
      const s = state.slots[cur];
      setTransition(c, 120, 'ease-out');
      c.el.style.transform = tf(s.x, s.y - 10, 1.04, 0);
      Sound.tick();

      const prog = k / hops;
      const wait = (60 + Math.pow(prog, 3) * 280) * state.speed;
      await sleep(wait);

      if (k < hops - 1) {
        setTransition(c, 120, 'ease-out');
        c.el.style.transform = tf(s.x, s.y, 1, 0);
        c.el.classList.add('dimmed');
      }
    }

    // 당첨 연출
    const win = state.cards[cur];
    win.el.classList.remove('dimmed', 'spot');
    win.el.classList.add('winner', 'is-hero');
    win.el.style.zIndex = '50';

    // 나머지 카드는 살짝 물러나기
    state.cards.forEach(function (c, i) {
      if (i === cur) return;
      const sl = state.slots[i];
      setTransition(c, 520 * state.speed);
      c.el.style.transform = tf(sl.x, sl.y + 16, 0.88, 0);
    });

    const s = boardSize();
    const L = state.layout;
    const heroScale = Math.max(1.1, Math.min((s.h * 0.92) / L.ch, (s.w * 0.62) / L.cw));
    const hx = s.w / 2 - L.cw / 2;
    const hy = s.h / 2 - L.ch / 2;

    setTransition(win, 700 * state.speed, 'cubic-bezier(.2,1.15,.3,1)');
    win.el.style.transform = tf(hx, hy, heroScale, 0);
    Sound.pop();
    await sleep(430 * state.speed);

    win.revealed = true;
    win.el.classList.add('revealed');
    Sound.flip();
    await sleep(430 * state.speed);

    Sound.fanfare();
    const r = win.el.getBoundingClientRect();
    FX.spawn(r.left + r.width / 2, r.top + r.height / 2, 90, { power: 1.5, scale: 1.3 });
    FX.spawn(r.left, r.bottom, 40, { angle: -Math.PI / 3, power: 1.6 });
    FX.spawn(r.right, r.bottom, 40, { angle: -Math.PI * 2 / 3, power: 1.6 });
    FX.rain(2600);

    state.stage = 'picked';
    state.busy = false;
    markNumpad();
    updateButtons();
    sayWin(win);
  }

  /* =========================================================
     UI 상태
     ========================================================= */
  function buildNumpad() {
    numpad.innerHTML = '';
    if (state.stage === 'idle') return;
    for (let n = 1; n <= state.count; n++) {
      const b = document.createElement('button');
      b.className = 'np-btn';
      b.textContent = String(n);
      b.dataset.no = String(n);
      b.addEventListener('click', function () { toggleNo(n); });
      numpad.appendChild(b);
    }
    markNumpad();
  }

  function markNumpad() {
    numpad.querySelectorAll('.np-btn').forEach(function (b) {
      const idx = indexOfNo(Number(b.dataset.no));
      const c = idx >= 0 ? state.cards[idx] : null;
      b.classList.toggle('used', !!(c && c.toggled));
      b.disabled = state.busy || !canFlip();
    });
  }

  function setStep(n) {
    steps.querySelectorAll('.step').forEach(function (el) {
      const v = Number(el.dataset.step);
      el.classList.toggle('active', v === n);
      el.classList.toggle('done', v < n);
    });
  }

  function updateButtons() {
    const idle = state.stage === 'idle';
    btnDeal.disabled = state.busy;
    btnDeal.textContent = idle ? '🌷 오늘의 카드 뽑기' : '🌷 새로 ' + state.count + '장 뽑기';

    // 섞은 뒤에도 전체 공개/덮기가 되도록
    const anyDown = state.cards.length === 0 || state.cards.some(function (c) { return !c.revealed; });
    btnRevealAll.disabled = state.busy || !canFlip() || state.cards.length === 0;
    btnRevealAll.textContent = anyDown ? '전체 공개' : '전체 덮기';

    btnShuffle.disabled = state.busy || idle;
    btnPick.disabled = state.busy || idle;
    btnPick.textContent = state.stage === 'picked' ? '✨ 다시 뽑기' : '✨ 한 장 뽑기';
    btnReset.disabled = state.busy;
    if (idle) btnDeal.classList.add('pulse'); else btnDeal.classList.remove('pulse');
  }

  /* 당첨 연출(딤·후광·확대) 정리. reposition=true 면 카드를 원래 자리로 되돌린다 */
  function clearPickState(reposition) {
    veil.classList.remove('on');
    state.cards.forEach(function (c, i) {
      c.el.classList.remove('dimmed', 'spot', 'winner', 'is-hero');
      c.el.style.zIndex = String(10 + i);
      if (reposition && state.slots[i]) {
        setTransition(c, 440 * state.speed);
        place(c, i);
      }
    });
  }

  function reset() {
    if (state.busy) return;
    board.innerHTML = '';
    board.classList.remove('anon');
    state.cards = [];
    state.stage = 'idle';
    numpad.innerHTML = '';
    veil.classList.remove('on');
    deckPile.classList.remove('hidden');
    FX.clear();
    btnShuffle.classList.remove('pulse');
    btnPick.classList.remove('pulse');
    setStep(1);
    updateButtons();
    say('먼저 오늘의 카드를 뽑아주세요.');
  }

  /* =========================================================
     이벤트
     ========================================================= */
  btnDeal.addEventListener('click', deal);
  btnRevealAll.addEventListener('click', flipAll);
  btnShuffle.addEventListener('click', doShuffle);
  btnPick.addEventListener('click', pickOne);
  btnReset.addEventListener('click', reset);

  btnSound.addEventListener('click', function () {
    state.sound = !state.sound;
    btnSound.textContent = state.sound ? '🔊' : '🔇';
    btnSound.classList.toggle('off', !state.sound);
    if (state.sound) { Sound.unlock(); Sound.pop(); }
  });

  btnSettings.addEventListener('click', function () {
    settingsPanel.hidden = !settingsPanel.hidden;
  });

  selCount.addEventListener('change', function () {
    state.count = Number(selCount.value);
    $('deckCount').textContent = state.count;
    reset();
  });

  selFace.addEventListener('change', function () {
    state.faceUpStart = selFace.value === 'up';
    reset();
  });

  selSpeed.addEventListener('change', function () {
    state.speed = Number(selSpeed.value);
    document.documentElement.style.setProperty('--speed', String(state.speed));
  });

  chkNumbers.addEventListener('change', function () {
    state.showNumbers = chkNumbers.checked;
    document.body.classList.toggle('hide-numbers', !state.showNumbers);
  });

  document.addEventListener('keydown', function (e) {
    if (e.target && /input|select|textarea/i.test(e.target.tagName)) return;
    const k = e.key.toLowerCase();

    if (k >= '1' && k <= '9') {
      const no = Number(k);
      if (no <= state.count) toggleNo(no);
      return;
    }
    if (k === 'd') { deal(); }
    else if (k === 'a') { flipAll(); }
    else if (k === 's') { doShuffle(); }
    else if (k === 'r') { reset(); }
    else if (k === ' ') { e.preventDefault(); pickOne(); }
  });

  let resizeTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      if (state.busy || state.stage === 'idle' || state.stage === 'picked') return;
      layoutAll(240, 0);
    }, 140);
  });

  document.addEventListener('click', function once() {
    Sound.unlock();
    document.removeEventListener('click', once);
  });

  /* 시작 */
  setStep(1);
  updateButtons();
  if (POOL.length === 0) {
    say('images 폴더에서 꽃 이미지를 찾지 못했습니다. flowers.js 를 확인해주세요.');
  }
})();
