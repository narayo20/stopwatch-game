(function () {
  'use strict';

  var TOTAL_ROUNDS = 5;
  var COUNT_STEP = 700;
  var MODE_TARGETS = { '5': 5000, '10': 10000, '15': 15000, random: null };
  var MODE_LABELS = { '5': '5초', '10': '10초', '15': '15초', random: '랜덤' };
  var BEST_KEY = 'stopwatchGame.bests.v1';
  var SOUND_KEY = 'stopwatchGame.sound.v1';

  var ui = {
    modeRow: document.getElementById('modeRow'),
    circle: document.getElementById('circle'),
    main: document.getElementById('circleMain'),
    sub: document.getElementById('circleSub'),
    hint: document.getElementById('hint'),
    status: document.getElementById('status'),
    rounds: document.getElementById('rounds'),
    actions: document.getElementById('actions'),
    bestLine: document.getElementById('bestLine'),
    soundBtn: document.getElementById('soundBtn'),
    resetBtn: document.getElementById('resetBtn')
  };

  var game = {
    phase: 'idle', // idle | countdown | running | result | finished
    mode: '10',
    results: [],
    target: MODE_TARGETS['10'],
    startedAt: 0,
    lastResult: null,
    finish: null,
    bests: {},
    sound: true
  };

  var timers = [];
  var audio = null;
  var inputLockUntil = 0;

  /* ---------------- storage ---------------- */

  function readStore(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (err) {
      return fallback;
    }
  }

  function writeStore(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (err) {
      /* storage unavailable */
    }
  }

  /* ---------------- audio ---------------- */

  function getAudio() {
    if (!game.sound) return null;
    var Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    if (!audio) audio = new Ctor();
    if (audio.state === 'suspended') audio.resume();
    return audio;
  }

  function tone(freq, duration, options) {
    var opts = options || {};
    var ctx = getAudio();
    if (!ctx) return;

    var t0 = ctx.currentTime + (opts.delay || 0);
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();

    osc.type = opts.type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (opts.slideTo) osc.frequency.exponentialRampToValueAtTime(opts.slideTo, t0 + duration);

    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(opts.volume == null ? 0.06 : opts.volume, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.03);
  }

  function sfxTick(index) {
    tone(360 + index * 130, 0.08, { type: 'triangle', volume: 0.05 });
  }

  function sfxStart() {
    tone(880, 0.16, { volume: 0.07 });
    tone(1320, 0.18, { volume: 0.05, delay: 0.07 });
  }

  function sfxStop() {
    tone(340, 0.16, { type: 'square', volume: 0.045, slideTo: 150 });
  }

  function sfxScore(score) {
    if (score >= 850) {
      tone(784, 0.1, { volume: 0.06 });
      tone(1046, 0.16, { volume: 0.05, delay: 0.09 });
    } else if (score >= 500) {
      tone(620, 0.1, { volume: 0.05 });
    } else {
      sfxFail();
    }
  }

  function trombone(freq, duration, delay, volume, slideTo, vibrato) {
    var ctx = getAudio();
    if (!ctx) return;

    var t0 = ctx.currentTime + (delay || 0);
    var osc = ctx.createOscillator();
    var filter = ctx.createBiquadFilter();
    var gain = ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) {
      osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + duration);
    }

    filter.type = 'lowpass';
    filter.Q.value = 3;
    filter.frequency.setValueAtTime(1500, t0);
    filter.frequency.exponentialRampToValueAtTime(420, t0 + duration * 0.9);

    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(volume, t0 + 0.045);
    gain.gain.setValueAtTime(volume * 0.9, t0 + duration * 0.55);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

    if (vibrato) {
      var lfo = ctx.createOscillator();
      var lfoGain = ctx.createGain();
      lfo.frequency.setValueAtTime(5.2, t0);
      lfo.frequency.linearRampToValueAtTime(6.4, t0 + duration);
      lfoGain.gain.setValueAtTime(0, t0);
      lfoGain.gain.linearRampToValueAtTime(freq * 0.018, t0 + duration * 0.55);
      lfo.connect(lfoGain);
      lfoGain.connect(osc.frequency);
      lfo.start(t0);
      lfo.stop(t0 + duration + 0.05);
    }

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.05);
  }

  // "와와와와~왕" — comedic sad-trombone failure sting.
  function sfxFail() {
    var notes = [392, 370, 349, 330];
    notes.forEach(function (freq, i) {
      trombone(freq, 0.26, i * 0.3, 0.045, freq * 0.9, false);
    });
    trombone(311, 1.15, 1.24, 0.055, 196, true);
  }

  function sfxFinish(isRecord) {
    var notes = isRecord ? [523, 659, 784, 1046] : [440, 523, 659];
    notes.forEach(function (freq, i) {
      tone(freq, isRecord ? 0.22 : 0.18, { volume: 0.055, delay: i * 0.11 });
    });
  }

  /* ---------------- background music (Web Audio, no files) ---------------- */

  // Driving 132 BPM suspense loop in D minor: heartbeat kick, pulsing bass,
  // off-beat hats and a sparse arpeggio. The loop never speeds up or changes,
  // so it cannot be used to infer the hidden elapsed time.
  var MUSIC_BPM = 132;
  var MUSIC_STEP = 60 / MUSIC_BPM / 4; // 16th note
  var MUSIC_STEPS = 32; // 2 bars of 4/4
  var MUSIC_VOLUME = 0.17;

  var D2 = 73.42;
  var F2 = 87.31;
  var C2 = 65.41;
  var BASS_LINE = [D2, D2, D2, D2, D2, D2, D2, D2, D2, D2, D2, D2, F2, F2, C2, D2];
  var ARP_BAR = [
    [349.23, 440.0, 523.25, 293.66], // F4 A4 C5 D4
    [440.0, 523.25, 349.23, 440.0]
  ];
  var ARP_STEPS = [1, 5, 9, 13];

  var music = null;

  function makeNoiseBuffer(ctx) {
    var length = Math.floor(ctx.sampleRate * 0.25);
    var buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    var data = buffer.getChannelData(0);
    for (var i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  function startMusic() {
    if (!game.sound || music) return;
    var ctx = getAudio();
    if (!ctx) return;

    var master = ctx.createGain();
    master.gain.setValueAtTime(0.0001, ctx.currentTime);
    master.gain.exponentialRampToValueAtTime(MUSIC_VOLUME, ctx.currentTime + 0.8);
    master.connect(ctx.destination);

    music = {
      ctx: ctx,
      master: master,
      noise: makeNoiseBuffer(ctx),
      step: 0,
      nextTime: ctx.currentTime + 0.08,
      timer: 0
    };
    music.timer = setInterval(scheduleMusic, 25);
    scheduleMusic();
  }

  function stopMusic() {
    if (!music) return;
    var m = music;
    music = null;
    clearInterval(m.timer);

    var t = m.ctx.currentTime;
    try {
      m.master.gain.cancelScheduledValues(t);
      m.master.gain.setValueAtTime(Math.max(0.0001, m.master.gain.value), t);
      m.master.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    } catch (err) {
      /* context already closed */
    }
    setTimeout(function () {
      try {
        m.master.disconnect();
      } catch (err) {
        /* already disconnected */
      }
    }, 500);
  }

  function scheduleMusic() {
    if (!music) return;
    var horizon = music.ctx.currentTime + 0.15;
    var guard = 0;
    while (music.nextTime < horizon && guard < 32) {
      playMusicStep(music.step, music.nextTime);
      music.nextTime += MUSIC_STEP;
      music.step = (music.step + 1) % MUSIC_STEPS;
      guard += 1;
    }
  }

  function musicKick(t, ctx) {
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(142, t);
    osc.frequency.exponentialRampToValueAtTime(46, t + 0.14);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.55, t + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    osc.connect(gain);
    gain.connect(music.master);
    osc.start(t);
    osc.stop(t + 0.22);
  }

  function musicBass(t, freq, ctx) {
    var osc = ctx.createOscillator();
    var filter = ctx.createBiquadFilter();
    var gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq, t);
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(460, t);
    filter.frequency.exponentialRampToValueAtTime(240, t + 0.15);
    filter.Q.value = 5;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.34, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(music.master);
    osc.start(t);
    osc.stop(t + 0.18);
  }

  function musicHat(t, ctx) {
    var src = ctx.createBufferSource();
    var filter = ctx.createBiquadFilter();
    var gain = ctx.createGain();
    src.buffer = music.noise;
    filter.type = 'highpass';
    filter.frequency.value = 7200;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.1, t + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(music.master);
    src.start(t);
    src.stop(t + 0.07);
  }

  function musicPluck(t, freq, ctx) {
    var osc = ctx.createOscillator();
    var filter = ctx.createBiquadFilter();
    var gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(freq, t);
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2800, t);
    filter.frequency.exponentialRampToValueAtTime(700, t + 0.13);
    filter.Q.value = 3;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.09, t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(music.master);
    osc.start(t);
    osc.stop(t + 0.2);
  }

  function playMusicStep(step, t) {
    var ctx = music.ctx;
    var pos = step % 16;
    var bar = step < 16 ? 0 : 1;

    if (pos % 4 === 0) musicKick(t, ctx);
    if (pos % 2 === 0) musicBass(t, BASS_LINE[Math.floor(step / 2)], ctx);
    if (pos % 4 === 2) musicHat(t, ctx);

    var arpIndex = ARP_STEPS.indexOf(pos);
    if (arpIndex !== -1) musicPluck(t, ARP_BAR[bar][arpIndex], ctx);
  }

  /* ---------------- helpers ---------------- */

  function sec(ms) {
    return (ms / 1000).toFixed(3);
  }

  function pts(n) {
    return n.toLocaleString('ko-KR');
  }

  function randomTarget() {
    return 3500 + Math.floor(Math.random() * 21) * 500;
  }

  function signOf(error) {
    if (error > 0) return '+';
    if (error < 0) return '−';
    return '±';
  }

  function gradeFor(error) {
    var a = Math.abs(error);
    if (a <= 50) return { label: '완벽해요!', emoji: '🎯', cls: 'grade-perfect' };
    if (a <= 120) return { label: '놀라워요!', emoji: '🔥', cls: 'grade-great' };
    if (a <= 250) return { label: '잘했어요!', emoji: '✨', cls: 'grade-good' };
    if (a <= 450) return { label: '좋아요', emoji: '👍', cls: 'grade-ok' };
    if (a <= 800) return { label: '아쉬워요', emoji: '😅', cls: 'grade-meh' };
    return { label: '다시 도전!', emoji: '💪', cls: 'grade-bad' };
  }

  function rankFor(total) {
    if (total >= 4600) return '그랜드마스터 🏆';
    if (total >= 3800) return '마스터 🥇';
    if (total >= 3000) return '숙련자 🥈';
    if (total >= 2100) return '견습생 🥉';
    return '루키 🌱';
  }

  function popMain() {
    if (!ui.main.animate) return;
    ui.main.animate(
      [
        { transform: 'scale(1.32)', opacity: 0.35 },
        { transform: 'scale(1)', opacity: 1 }
      ],
      { duration: 320, easing: 'ease-out' }
    );
  }

  /* ---------------- rendering ---------------- */

  function resultCard(r) {
    var g = gradeFor(r.error);
    var absErr = Math.abs(r.error);
    var note =
      absErr < 15
        ? '오차가 거의 없어요. 완벽합니다!'
        : r.error > 0
          ? sec(absErr) + '초 늦게 멈췄어요'
          : sec(absErr) + '초 빨리 멈췄어요';

    return (
      '<div class="result-card ' + g.cls + '">' +
        '<div class="result-top">' +
          '<span class="grade-emoji" aria-hidden="true">' + g.emoji + '</span>' +
          '<span class="grade-label">' + g.label + '</span>' +
          '<span class="result-score">+' + r.score + '점</span>' +
        '</div>' +
        '<div class="result-meta">' +
          '<span>목표 <b>' + sec(r.target) + '초</b></span>' +
          '<span>기록 <b>' + sec(r.elapsed) + '초</b></span>' +
          '<span>오차 <b>' + signOf(r.error) + sec(absErr) + '초</b></span>' +
        '</div>' +
        '<p class="result-note">' + note + '</p>' +
      '</div>'
    );
  }

  function finalCard(f) {
    var rows = game.results
      .map(function (r, i) {
        return (
          '<li>' +
            '<span class="fl-round">' + (i + 1) + 'R</span>' +
            '<span class="fl-detail">기록 ' + sec(r.elapsed) + '초 <em>(' +
              signOf(r.error) + sec(Math.abs(r.error)) + '초)</em></span>' +
            '<b>+' + r.score + '</b>' +
          '</li>'
        );
      })
      .join('');

    var recordLine;
    if (f.isRecord) {
      recordLine =
        '<p class="record-line is-new">🎉 신기록!' +
          (f.prevBest > 0 ? ' 이전 최고 ' + pts(f.prevBest) + '점' : '') +
        '</p>';
    } else if (f.prevBest > 0) {
      recordLine =
        '<p class="record-line">최고 기록 ' + pts(f.prevBest) + '점 · ' +
          pts(Math.max(0, f.prevBest - f.total)) + '점 차이</p>';
    } else {
      recordLine = '<p class="record-line">점수를 내면 최고 기록이 저장돼요</p>';
    }

    return (
      '<div class="final-card">' +
        '<p class="final-kicker">5 라운드 완료 · ' + MODE_LABELS[game.mode] + '</p>' +
        '<p class="final-total">' + pts(f.total) +
          '<span> / ' + pts(TOTAL_ROUNDS * 1000) + '점</span></p>' +
        '<p class="final-rank">' + rankFor(f.total) + '</p>' +
        recordLine +
        '<ul class="final-list">' + rows + '</ul>' +
      '</div>'
    );
  }

  function renderRounds() {
    var active = game.phase !== 'idle' && game.phase !== 'finished';

    ui.rounds.innerHTML = Array.from({ length: TOTAL_ROUNDS }, function (_, i) {
      var result = game.results[i];
      var classes = ['round-chip'];
      if (result) classes.push('is-done');
      if (!result && active && i === game.results.length) classes.push('is-current');

      return (
        '<li class="' + classes.join(' ') + '">' +
          '<span>' + (i + 1) + 'R</span>' +
          '<b>' + (result ? result.score : '–') + '</b>' +
        '</li>'
      );
    }).join('');
  }

  function renderBest() {
    var best = game.bests[game.mode];
    if (best && typeof best.score === 'number') {
      ui.bestLine.innerHTML =
        '👑 ' + MODE_LABELS[game.mode] + ' 최고 기록 <b>' + pts(best.score) + '점</b>';
    } else {
      ui.bestLine.textContent = MODE_LABELS[game.mode] + ' 최고 기록이 아직 없어요';
    }
  }

  function render() {
    var phase = game.phase;

    ui.modeRow.classList.toggle('is-locked', phase !== 'idle' && phase !== 'finished');
    Array.prototype.forEach.call(ui.modeRow.children, function (btn) {
      btn.classList.toggle('is-active', btn.dataset.mode === game.mode);
    });

    ui.circle.className = 'circle';
    ui.circle.disabled = false;

    if (phase === 'idle') {
      ui.circle.setAttribute('aria-label', '게임 시작');
      ui.main.textContent = 'START';
      ui.sub.textContent = game.mode === 'random' ? '무작위 목표' : '목표 ' + MODE_LABELS[game.mode];
      ui.hint.textContent = '화면에 시간이 보이지 않아요. 감으로 정확히 멈춰보세요!';
      ui.status.innerHTML = '';
      ui.actions.innerHTML = '';
    } else if (phase === 'countdown') {
      ui.circle.classList.add('is-countdown');
      ui.circle.disabled = true;
      ui.circle.setAttribute('aria-label', '카운트다운');
      ui.sub.textContent = '목표 ' + sec(game.target) + '초';
      ui.hint.textContent = '카운트가 끝나면 바로 시작돼요';
      ui.status.innerHTML = '<p class="pill">목표 시간 <b>' + sec(game.target) + '초</b></p>';
      ui.actions.innerHTML = '';
    } else if (phase === 'running') {
      ui.circle.classList.add('is-running');
      ui.circle.setAttribute('aria-label', '멈추기');
      ui.main.textContent = 'STOP';
      ui.sub.textContent = '목표 ' + sec(game.target) + '초';
      ui.hint.textContent = '지금이에요! 원을 눌러 멈추세요';
      ui.status.innerHTML = '<p class="live">⏱ 목표 <b>' + sec(game.target) + '초</b></p>';
      ui.actions.innerHTML = '';
    } else if (phase === 'result') {
      var r = game.lastResult;
      ui.circle.classList.add('is-result');
      ui.circle.setAttribute('aria-label', '다음 라운드');
      ui.main.textContent = sec(r.elapsed);
      ui.sub.textContent = '목표 ' + sec(r.target) + '초';
      ui.hint.textContent = '결과를 확인하고 다음 라운드로!';
      ui.status.innerHTML = resultCard(r);

      var isLast = game.results.length >= TOTAL_ROUNDS;
      ui.actions.innerHTML =
        '<button class="btn btn-primary" type="button" data-action="next">' +
          (isLast ? '결과 보기' : '다음 라운드') +
        '</button>';
    } else if (phase === 'finished') {
      var f = game.finish;
      ui.circle.classList.add('is-result');
      ui.circle.setAttribute('aria-label', '다시 도전');
      ui.main.textContent = pts(f.total);
      ui.sub.textContent = f.isRecord ? '새 최고 기록!' : '다시 도전해볼까요?';
      ui.hint.textContent = '5라운드 완료! 기록을 확인하세요';
      ui.status.innerHTML = finalCard(f);
      ui.actions.innerHTML =
        '<button class="btn btn-primary" type="button" data-action="retry">다시 도전</button>';
    }

    renderRounds();
    renderBest();
  }

  /* ---------------- game flow ---------------- */

  function clearTimers() {
    timers.forEach(function (id) {
      clearTimeout(id);
    });
    timers = [];
  }

  function startRound() {
    if (game.phase !== 'idle' && game.phase !== 'result') return;

    clearTimers();
    game.target = game.mode === 'random' ? randomTarget() : MODE_TARGETS[game.mode];
    game.phase = 'countdown';
    render();
    startMusic();
    runCountdown();
  }

  function runCountdown() {
    var step = 0;

    function next() {
      step += 1;
      if (step <= 3) {
        ui.main.textContent = String(4 - step);
        popMain();
        sfxTick(step - 1);
        timers.push(setTimeout(next, COUNT_STEP));
      } else {
        beginRunning();
      }
    }

    next();
  }

  function beginRunning() {
    timers = [];
    game.phase = 'running';
    game.startedAt = performance.now();
    render();
    sfxStart();
  }

  function stopRound() {
    if (game.phase !== 'running') return;

    var elapsed = performance.now() - game.startedAt;
    var error = elapsed - game.target;
    var score = Math.max(0, Math.round(1000 - Math.abs(error) * 1.5));
    var result = { target: game.target, elapsed: elapsed, error: error, score: score };

    game.results.push(result);
    game.lastResult = result;
    game.phase = 'result';
    inputLockUntil = performance.now() + 450;

    stopMusic();
    sfxStop();
    render();
    popMain();
    sfxScore(score);
  }

  function advance() {
    if (game.phase !== 'result') return;
    if (game.results.length >= TOTAL_ROUNDS) {
      finishGame();
      return;
    }
    startRound();
  }

  function finishGame() {
    var total = game.results.reduce(function (sum, r) {
      return sum + r.score;
    }, 0);
    var best = game.bests[game.mode];
    var prevBest = best && typeof best.score === 'number' ? best.score : 0;
    var isRecord = total > prevBest;

    if (isRecord) {
      game.bests[game.mode] = { score: total, date: Date.now() };
      writeStore(BEST_KEY, game.bests);
    }

    game.finish = { total: total, prevBest: prevBest, isRecord: isRecord };
    game.phase = 'finished';
    inputLockUntil = performance.now() + 300;

    stopMusic();
    render();
    sfxFinish(isRecord);
  }

  function resetGame() {
    clearTimers();
    stopMusic();
    game.phase = 'idle';
    game.results = [];
    game.lastResult = null;
    game.finish = null;
    inputLockUntil = 0;
    render();
  }

  function setMode(mode) {
    if (!(mode in MODE_TARGETS)) return;
    if (game.phase !== 'idle' && game.phase !== 'finished') return;

    game.mode = mode;
    if (game.phase === 'finished') {
      resetGame();
    } else {
      render();
    }
    tone(620, 0.06, { volume: 0.04 });
  }

  function primaryAction() {
    if (performance.now() < inputLockUntil) return;

    switch (game.phase) {
      case 'idle':
        startRound();
        break;
      case 'running':
        stopRound();
        break;
      case 'result':
        advance();
        break;
      case 'finished':
        resetGame();
        break;
      default:
        break;
    }
  }

  /* ---------------- events ---------------- */

  ui.circle.addEventListener('click', primaryAction);

  ui.modeRow.addEventListener('click', function (event) {
    var btn = event.target.closest('.mode-btn');
    if (btn) setMode(btn.dataset.mode);
  });

  ui.actions.addEventListener('click', function (event) {
    var btn = event.target.closest('[data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'next') advance();
    if (btn.dataset.action === 'retry') resetGame();
  });

  ui.soundBtn.addEventListener('click', function () {
    game.sound = !game.sound;
    writeStore(SOUND_KEY, game.sound);
    initSoundButton();
    if (game.sound) {
      if (game.phase === 'countdown' || game.phase === 'running') startMusic();
      tone(760, 0.08, { volume: 0.05 });
    } else {
      stopMusic();
    }
  });

  ui.resetBtn.addEventListener('click', function () {
    resetGame();
    tone(320, 0.08, { volume: 0.04, slideTo: 190 });
  });

  window.addEventListener('keydown', function (event) {
    if (event.repeat) return;
    if (event.code !== 'Space' && event.code !== 'Enter') return;

    var target = event.target;
    var isOtherButton = target && target.tagName === 'BUTTON' && target !== ui.circle;
    if (isOtherButton) return; // 네이티브 버튼 동작에 맡김

    event.preventDefault();
    primaryAction();
  });

  function initSoundButton() {
    ui.soundBtn.textContent = game.sound ? '🔊' : '🔇';
    ui.soundBtn.classList.toggle('is-off', !game.sound);
    ui.soundBtn.setAttribute('aria-pressed', String(game.sound));
  }

  /* ---------------- init ---------------- */

  function init() {
    var savedBests = readStore(BEST_KEY, {});
    game.bests = savedBests && typeof savedBests === 'object' ? savedBests : {};
    game.sound = readStore(SOUND_KEY, true) !== false;

    initSoundButton();
    render();
  }

  init();
})();
