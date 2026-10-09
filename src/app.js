(function () {
  'use strict';
  const C = window.ValennaCore, A = window.VALENNA_ASSETS;
  const stylesheet = document.querySelector('link[rel="stylesheet"]');
  // Fail before creating audio, observers or the game when a boot dependency is
  // missing. In WebKit a stylesheet error event can arrive after DOMContentLoaded.
  if (!C || !A || !window.ValennaAssetIO || (stylesheet && (!stylesheet.sheet || stylesheet.sheet.cssRules.length === 0))) {
    document.getElementById('bootError').hidden = false;
    return;
  }
  const $ = id => document.getElementById(id);
  const stage = $('stage'), canvas = $('game'), ctx = canvas.getContext('2d', { alpha: false });
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const storage = {
    read(key, fallback) { try { const value = localStorage.getItem('valenna.' + key); return value === null ? fallback : JSON.parse(value); } catch (_) { return fallback; } },
    write(key, value) { try { localStorage.setItem('valenna.' + key, JSON.stringify(value)); } catch (_) { /* Optional records must never block offline play. */ } },
  };
  let mode = 'standard';
  const modeInfo = {
    standard: { name: '标准', description: '熟悉的航线，自由穿越障碍。', record: 'best' },
    tharsis: { name: '塔尔西斯X', description: '更窄通道 · 更大落差 · 严格判定', record: 'best.tharsis' },
    antey: { name: '安泰宇航', description: '安心返航，观看开伞着陆。', record: null },
  };
  let best = Math.max(0, Number(storage.read('best', 0)) || 0);
  let state = 'loading', previousState = 'ready', game = new C.Game();
  let sceneTime = 0, clock = 0, lastFrame = 0, accumulator = 0, lastScore = 0;
  let flapGlow = 0, crashedAt = 0, freshRecord = false, explosionPlayed = false, landingCelebrated = false;
  const isDialogOpen = () => $('aboutDialog').open || $('soundDialog').open;
  let images = {}, lastCaption = '', started = false, gameTrail = [];
  const INTRO_END = 14.5, EXPLODE_AT = 7.8, TOUCHDOWN_AT = 20.5, ARRIVAL_END = 22;
  const captions = [
    { from: 1.0, to: 3.7, text: '在火箭发射后的41秒，' },
    { from: 3.7, to: 7.8, text: '诺克斯上空再次响起\n瓦莲娜肘击舱门的声音，' },
    { from: 7.8, to: 10.1, text: '此时玛丽安娜明白，' },
    { from: 10.1, to: INTRO_END, text: '她再也无法阻止瓦莲娜\n单兵飞出大气层返回地球了…' },
  ];

  class Sound {
    constructor() {
      this.audio = $('music'); this.list = new C.Playlist(A.tracks.length);
      this.volume = C.clamp(Number(storage.read('volume', .25)) || 0, 0, 1);
      this.effectsVolume = C.clamp(Number(storage.read('effectsVolume', .85)) || 0, 0, 1);
      this.muted = Boolean(storage.read('muted', false)); this.active = false; this.blocked = false;
      this.context = null; this.gain = null; this.musicGain = null; this.generation = 0; this.shouldPlay = false;
      this.objectUrl = null; this.loadingTimer = null; this.loadedIndex = -1; this.mediaCleanup = null; this.buffering = false; this.effectBytes = {}; this.effectReads = {}; this.effectErrors = {}; this.effectFailed = {}; this.resumePosition = 0;
      this.failureBuffer = null; this.failureReady = null; this.failureSource = null; this.failureGeneration = 0;
      this.cheerBuffer = null; this.cheerReady = null; this.cheerSource = null; this.cheerGeneration = 0;
      A.tracks.forEach((track, index) => {
        const button = document.createElement('button');
        button.type = 'button'; button.textContent = track.title; button.dataset.track = index;
        button.addEventListener('click', () => chooseTrack(index));
        $('trackList').appendChild(button);
      });
      this.select(0); this.applyVolume();
    }
    invalidate() {
      this.generation++; clearTimeout(this.loadingTimer); this.loadingTimer = null;
      if (this.mediaCleanup) this.mediaCleanup(); this.mediaCleanup = null;
    }
    select(index) {
      if (!Number.isInteger(index) || index < 0 || index >= A.tracks.length) return;
      this.invalidate(); this.shouldPlay = false; this.blocked = false; this.buffering = false;
      this.audio.pause(); this.audio.removeAttribute('src');
      // Detach the previous download; never mount the newly selected MP3 here.
      if (this.loadedIndex !== -1) this.audio.load();
      if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null; this.loadedIndex = -1; this.resumePosition = 0; this.list.index = index; this.sync();
    }
    mount() {
      if (this.loadedIndex === this.list.index) return;
      const src = A.tracks[this.list.index].src;
      if (A.delivery === 'online') {
        const url = new URL(src, document.baseURI);
        if (!/^https?:$/.test(url.protocol) || url.origin !== location.origin) throw new Error('Music must be same-origin HTTP(S)');
        this.audio.src = url.href;
      } else {
        const binary = atob(src.slice(src.indexOf(',') + 1));
        const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
        this.objectUrl = URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' })); this.audio.src = this.objectUrl;
      }
      this.loadedIndex = this.list.index;
    }
    sync() {
      const title = A.tracks[this.list.index].title;
      $('trackName').textContent = title; $('soundTrack').textContent = title;
      $('radioState').textContent = !this.active ? '待机' : this.buffering ? '音乐缓冲中…' : this.audio.paused ? '已选曲 · 暂停' : this.muted ? '播放中 · 静音' : '正在播放';
      $('nowPlaying').setAttribute('aria-label', '打开随身电台，当前曲目：' + title);
      for (const button of $('trackList').children) button.setAttribute('aria-pressed', String(Number(button.dataset.track) === this.list.index));
      $('soundIcon').textContent = this.muted || (this.volume === 0 && this.effectsVolume === 0) ? '♪' : '♫';
      $('soundButton').setAttribute('aria-label', this.muted ? '声音设置，当前静音' : '声音设置');
      $('mute').textContent = this.muted ? '开启声音' : '静音';
      $('volume').value = String(Math.round(this.volume * 100));
      $('volumeValue').textContent = Math.round(this.volume * 100) + '%';
      $('effectsVolume').value = String(Math.round(this.effectsVolume * 100));
      $('effectsValue').textContent = Math.round(this.effectsVolume * 100) + '%';
      $('audioRecover').hidden = !this.blocked || !this.active;
    }
    applyVolume() {
      this.audio.volume = this.musicGain ? 1 : this.volume; this.audio.muted = this.muted;
      if (this.musicGain) {
        this.musicGain.gain.cancelScheduledValues(this.context.currentTime);
        this.musicGain.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.context.currentTime, .015);
      }
      if (this.gain) this.gain.gain.setTargetAtTime(this.muted ? 0 : this.effectsVolume, this.context.currentTime, .01);
      this.sync();
    }
    duck(duration, level = .38) {
      if (!this.musicGain || this.muted || !this.effectsVolume) return;
      const now = this.context.currentTime, gain = this.musicGain.gain;
      gain.cancelScheduledValues(now); gain.setTargetAtTime(this.volume * level, now, .012);
      gain.setTargetAtTime(this.volume, now + duration, .12);
    }
    stopFailure() {
      this.failureGeneration++;
      if (this.failureSource) { this.failureSource.stop(); this.failureSource.disconnect(); this.failureSource = null; }
      this.applyVolume();
    }
    playFailure() { this.playEffect('failure', ['crash', 'over']); }
    stopCheer() {
      this.cheerGeneration++;
      if(this.cheerSource){this.cheerSource.stop();this.cheerSource.disconnect();this.cheerSource=null;}
    }
    playCheer() { this.playEffect('cheer', ['arrival', 'success']); }
    effectStatus() {
      const failed = Object.keys(this.effectErrors);
      $('effectStatus').hidden = failed.length === 0;
      $('retryEffects').hidden = failed.length === 0;
      $('effectStatus').textContent = failed.map(key => key === 'failure' ? '失败音效' : '着陆欢呼').join('、') + '暂不可用，可重试加载。';
    }
    readEffect(key, retry = false) {
      if (this.effectBytes[key]) return Promise.resolve(this.effectBytes[key]);
      if (this.effectReads[key]) return this.effectReads[key];
      if (this.effectFailed[key] && !retry) return Promise.reject(this.effectFailed[key]);
      delete this.effectFailed[key];
      const request = window.ValennaAssetIO.readArrayBuffer(A.effects[key].src, { timeoutMs: 10000 }).then(bytes => {
        this.effectBytes[key] = bytes; delete this.effectErrors[key]; this.effectStatus(); return bytes;
      }).catch(error => { this.effectFailed[key] = error; this.effectErrors[key] = error.message; this.effectStatus(); console.warn('Effect read ' + key + ':', error.message); throw error;
      }).finally(() => { this.effectReads[key] = null; });
      this.effectReads[key] = request; return request;
    }
    prefetchEffects() { for (const key of ['failure', 'cheer']) this.readEffect(key).catch(() => {}); }
    prepareEffect(key, retry = false) {
      if (this[key + 'Buffer']) return Promise.resolve(this[key + 'Buffer']);
      if (this[key + 'Ready']) return this[key + 'Ready'];
      if (!this.context || (this.effectFailed[key] && !retry)) return Promise.resolve(null);
      const request = this.readEffect(key, retry).then(bytes => this.context.decodeAudioData(bytes.slice(0))).then(buffer => {
        this[key + 'Buffer'] = buffer; delete this.effectErrors[key]; delete this.effectFailed[key]; this.effectStatus(); return buffer;
      }).catch(error => { delete this.effectBytes[key]; this.effectFailed[key] = error; this.effectErrors[key] = error.message; this.effectStatus(); console.warn('Effect unavailable ' + key + ':', error.message); return null;
      }).finally(() => { this[key + 'Ready'] = null; });
      this[key + 'Ready'] = request; return request;
    }
    playEffect(key, scenes) {
      const generation = ++this[key + 'Generation'], requestedAt = performance.now();
      if (this.muted || !this.effectsVolume) return;
      this.prepareEffect(key).then(buffer => {
        if (!buffer || generation !== this[key + 'Generation'] || !scenes.includes(state) || document.hidden || this.context.state !== 'running' || this.muted || !this.effectsVolume || performance.now() - requestedAt > 1000) return;
        const source = this.context.createBufferSource(); source.buffer = buffer; source.connect(this.gain); this[key + 'Source'] = source;
        if (key === 'failure') this.duck(buffer.duration + .12, .22);
        source.start(); source.onended = () => { source.disconnect(); if (this[key + 'Source'] === source) this[key + 'Source'] = null; };
      });
    }
    unlockEffects() {
      if (!this.context) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) { $('effectStatus').hidden = false; $('effectStatus').textContent = '此浏览器暂不支持游戏音效。'; return; }
        try {
          this.context = new AudioContext(); this.gain = this.context.createGain();
          const mixer = this.context.createDynamicsCompressor();
          mixer.threshold.value = -6; mixer.knee.value = 12; mixer.ratio.value = 8;
          mixer.attack.value = .003; mixer.release.value = .18;
          mixer.connect(this.context.destination); this.gain.connect(mixer);
          // iOS leaves HTMLMediaElement.volume to the hardware controls. A gain
          // node supplies the in-game volume control while keeping one media element.
          this.musicGain = this.context.createGain();
          this.mediaSource = this.context.createMediaElementSource(this.audio);
          this.mediaSource.connect(this.musicGain); this.musicGain.connect(mixer);
          this.applyVolume();
        } catch (error) { this.musicGain = null; this.applyVolume(); console.info('Optional sound effects unavailable:', error.name); return; }
      }
      for (const key of ['failure', 'cheer']) this.prepareEffect(key);
      if (this.context.state === 'suspended') this.context.resume().then(() => {
        if (!this.shouldPlay || document.hidden || state === 'paused') return this.context.suspend();
      }).catch(error => console.info('Sound effects are suspended:', error.name));
    }
    start() { this.active = true; this.shouldPlay = true; this.unlockEffects(); this.play(); }
    play(retry = false) {
      if (state === 'paused' || document.hidden) return;
      this.shouldPlay = true; this.invalidate(); this.mount();
      const generation = this.generation, loadedIndex = this.loadedIndex, expected = this.audio.src;
      const valid = () => generation === this.generation && this.shouldPlay && !document.hidden && state !== 'paused' && this.list.index === loadedIndex && this.audio.src === expected;
      const current = () => valid() && this.audio.currentSrc === expected;
      const fail = message => { if (!valid()) return; clearTimeout(this.loadingTimer); this.blocked = true; this.buffering = false; this.sync(); $('audioRecover').textContent = message; };
      const wait = () => {
        if (!valid() || this.loadingTimer) return;
        this.buffering = true; this.sync(); const position = this.audio.currentTime;
        this.loadingTimer = setTimeout(() => {
          this.loadingTimer = null;
          if (!valid()) return;
          if (this.audio.currentTime <= position + .1 || this.audio.readyState < 2) fail('音乐尚未就绪 · 轻触重试');
          else { this.buffering = false; this.sync(); }
        }, 8000);
      };
      const handlers = {
        ended: () => { if (current() && this.audio.ended) { this.select(this.list.next()); this.play(); } },
        error: () => { if (current() && this.audio.error) fail('音乐未能播放 · 轻触重试'); },
        playing: () => { if (!current() || this.audio.paused || this.audio.readyState < 2) return; clearTimeout(this.loadingTimer); this.loadingTimer = null; this.blocked = false; this.buffering = false; this.sync(); },
        waiting: () => { if (current() && this.audio.readyState < 3) wait(); },
        stalled: () => { if (current()) wait(); },
        loadedmetadata: () => {
          if (!current() || !this.resumePosition) return;
          try { this.audio.currentTime = this.resumePosition; this.resumePosition = 0; }
          catch (error) { console.warn('Music position recovery failed:', error.message); }
        }
      };
      for (const [event, handler] of Object.entries(handlers)) this.audio.addEventListener(event, handler);
      this.mediaCleanup = () => { for (const [event, handler] of Object.entries(handlers)) this.audio.removeEventListener(event, handler); };
      if (retry || this.audio.error) { this.resumePosition = this.audio.currentTime || this.resumePosition; this.audio.load(); }
      if (this.audio.paused || this.audio.readyState < 3) wait();
      else { this.buffering = false; this.blocked = false; this.sync(); }
      const attempt = this.audio.play();
      if (attempt && attempt.catch) attempt.catch(error => {
        if (valid()) fail(error.name === 'NotAllowedError' ? '轻触启用音乐' : '音乐未能播放 · 轻触重试');
      });
    }
    pause() {
      this.shouldPlay = false; this.invalidate(); this.buffering = false; this.audio.pause(); this.stopFailure(); this.stopCheer(); this.sync();
      if (this.context?.state === 'running') this.context.suspend().catch(error => console.info('Audio pause:', error.name));
    }
    resume(retry = false) { if (this.active && !document.hidden && state !== 'paused') { this.shouldPlay = true; this.unlockEffects(); this.play(retry); } }
    tone(kind) {
      if (!this.context || this.context.state !== 'running' || this.muted || !this.effectsVolume) return;
      const now = this.context.currentTime;
      if (kind === 'explosion') this.duck(.85);
      if (kind === 'explosion') {
        const size = Math.floor(this.context.sampleRate * .72);
        const buffer = this.context.createBuffer(1, size, this.context.sampleRate);
        const samples = buffer.getChannelData(0);
        for (let i = 0; i < size; i++) samples[i] = (Math.random() * 2 - 1) * (1 - i / size) ** 2;
        const noise = this.context.createBufferSource(); noise.buffer = buffer;
        const filter = this.context.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 950;
        noise.connect(filter); filter.connect(this.gain); noise.start();
        noise.onended = () => { noise.disconnect(); filter.disconnect(); };
        return;
      }
      const oscillator = this.context.createOscillator(), envelope = this.context.createGain();
      const freq = kind === 'score' ? 740 : kind === 'crash' ? 115 : 310;
      const duration = kind === 'score' ? .18 : kind === 'crash' ? .28 : .075;
      oscillator.type = 'sine'; oscillator.frequency.setValueAtTime(freq, now);
      oscillator.frequency.exponentialRampToValueAtTime(kind === 'score' ? 1080 : freq * .46, now + duration);
      envelope.gain.setValueAtTime(.001, now); envelope.gain.exponentialRampToValueAtTime(.55, now + .008);
      envelope.gain.exponentialRampToValueAtTime(.001, now + duration);
      oscillator.connect(envelope); envelope.connect(this.gain); oscillator.start(now); oscillator.stop(now + duration);
      oscillator.onended = () => { oscillator.disconnect(); envelope.disconnect(); };
    }
  }
  const sound = new Sound();
  const rand = C.seededRandom(80041);
  const stars = Array.from({ length: 72 }, () => ({ x: rand() * C.W, y: rand() * C.H, r: .45 + rand() * 1.1, depth: .15 + rand() * .6, phase: rand() * 6.28 }));
  const debris = Array.from({ length: 20 }, () => ({ angle: rand() * Math.PI * 2, speed: 45 + rand() * 135, spin: rand() * 8 - 4, size: 3 + rand() * 7 }));

  function resize() {
    const rect = stage.getBoundingClientRect();
    stage.style.setProperty('--u', rect.width / C.W + 'px');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(rect.width * dpr); canvas.height = Math.round(rect.height * dpr);
    ctx.setTransform(canvas.width / C.W, 0, 0, canvas.height / C.H, 0, 0);
  }
  new ResizeObserver(resize).observe(stage);
  window.addEventListener('resize', resize);

  function setState(next) {
    state = next; stage.dataset.state = state; accumulator = 0;
    $('loading').hidden = state !== 'loading'; $('menu').hidden = state !== 'menu';
    $('ready').hidden = state !== 'ready'; $('over').hidden = state !== 'over'; $('pause').hidden = state !== 'paused';
    $('success').hidden = state !== 'success';
    $('toolbar').hidden = state === 'loading';
    $('hud').hidden = !['playing', 'crash'].includes(state);
    $('skip').hidden = state !== 'intro'; $('pauseButton').hidden = !['playing', 'ready', 'arrival'].includes(state);
    $('introCaption').hidden = !['intro', 'arrival'].includes(state) || !lastCaption;
    $('nowPlaying').hidden = !started || state === 'menu' || state === 'loading';
    $('menuBest').textContent = best;
  }
  function startLaunch() {
    if (state !== 'menu' || isDialogOpen()) return;
    // Every full launch has an anthem cue, even after browsing the radio.
    // Failed-round retry uses readyRound directly and keeps music progress.
    sound.select(0); sound.start(); started = true;
    sound.stopFailure(); sound.stopCheer(); sceneTime = 0; lastFrame = performance.now(); lastCaption = ''; explosionPlayed = false; landingCelebrated = false; setState(mode === 'antey' ? 'arrival' : 'intro');
    $('announcement').textContent = mode === 'antey' ? '安泰宇航发射，目的地地球。' : '发射开始。开场动画可跳过。';
  }
  function readyRound() {
    sound.stopFailure(); game = new C.Game(Date.now() ^ Math.floor(Math.random() * 0xffffffff), mode, A.playerMask);
    sceneTime = 0; lastScore = 0; gameTrail = []; flapGlow = 0; $('score').textContent = '0';
    setState('ready'); $('announcement').textContent = '准备起飞。轻触、点击或按空格向上飞。';
  }
  function flap() {
    if (isDialogOpen()) return;
    if (state === 'menu') { startLaunch(); return; }
    if (state === 'ready') { sound.resume(); setState('playing'); }
    if (state !== 'playing') return;
    game.flap(); flapGlow = 1; sound.tone('flap');
  }
  function pauseGame() {
    if (!['playing', 'ready', 'intro', 'arrival'].includes(state)) return;
    previousState = state; setState('paused'); sound.pause();
    $('announcement').textContent = '飞行已暂停。';
  }
  function resumeGame() {
    if (state !== 'paused') return;
    lastFrame = performance.now(); setState(previousState); sound.resume();
  }
  function home() { sound.stopFailure(); sound.stopCheer(); sceneTime = 0; gameTrail = []; setState('menu'); if (started) sound.resume(); }
  function selectMode(value) {
    mode = modeInfo[value] ? value : 'standard'; stage.dataset.mode = mode;
    const info = modeInfo[mode]; best = info.record ? Math.max(0, Number(storage.read(info.record, 0)) || 0) : 0;
    $('modeDescription').textContent = info.description;
    $('recordLabel').textContent = info.name + '最高纪录'; $('menuBest').textContent = best;
    $('bestLine').hidden = mode === 'antey';
    document.querySelector('.control-hint').textContent = mode === 'antey' ? '无需操作 · 静候安全着陆' : '轻触屏幕 · 点击鼠标 · 空格上升';
    $('flightLabel').textContent = info.name + ' · 朝着地球，继续飞。';
  }
  function showResult() {
    $('finalScore').textContent = game.score; $('finalBest').textContent = best;
    $('resultHeading').textContent = modeInfo[mode].name + ' · ' + (freshRecord ? '新的最远纪录' : '本次飞行记录');
    const messages = { rocket: '绕过火箭残骸，就离地球更近一点。', satellite: '下一次，记得避开太阳能板。', asteroid: '这片小行星带，比想象中热闹。', boundary: '别飞出视野，地球还在等你。' };
    $('resultMessage').textContent = messages[game.cause] || '地球还在那里，再试一次吧。';
    setState('over'); $('announcement').textContent = `飞行结束，穿过 ${game.score} 组障碍。最高纪录 ${best}。`;
  }
  function openDialog(id) {
    if (isDialogOpen()) return;
    $(id).showModal();
  }
  function chooseTrack(index) {
    if (index !== sound.list.index) sound.select(index);
    started = true; sound.active = true;
    if (state !== 'paused') sound.start();
    else { sound.shouldPlay = false; sound.sync(); }
    $('nowPlaying').hidden = state === 'menu' || state === 'loading';
  }
  for (const id of ['aboutDialog', 'soundDialog']) {
    $(id).addEventListener('close', () => { accumulator = 0; lastFrame = performance.now(); });
    $(id).addEventListener('click', event => {
      if (event.target !== $(id)) return;
      const box = $(id).getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) $(id).close();
    });
  }
  document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => $(button.dataset.close).close()));
  $('start').addEventListener('click', startLaunch);
  document.querySelectorAll('input[name="mode"]').forEach(input => input.addEventListener('change', () => selectMode(input.value)));
  $('watchAgain').addEventListener('click', () => { setState('menu'); startLaunch(); });
  $('successHome').addEventListener('click', home);
  $('skip').addEventListener('click', () => { if (state === 'intro') readyRound(); });
  $('retry').addEventListener('click', () => { sound.resume(); readyRound(); });
  $('home').addEventListener('click', home); $('pauseHome').addEventListener('click', home);
  $('resume').addEventListener('click', resumeGame); $('pauseButton').addEventListener('click', pauseGame);
  $('aboutButton').addEventListener('click', () => openDialog('aboutDialog'));
  $('soundButton').addEventListener('click', () => openDialog('soundDialog'));
  $('nowPlaying').addEventListener('click', () => openDialog('soundDialog'));
  $('nextTrack').addEventListener('click', () => chooseTrack(C.nextTrackIndex(sound.list.index, A.tracks.length)));
  $('volume').addEventListener('input', event => { sound.volume = Number(event.target.value) / 100; storage.write('volume', sound.volume); sound.applyVolume(); });
  $('effectsVolume').addEventListener('input', event => { sound.effectsVolume = Number(event.target.value) / 100; storage.write('effectsVolume', sound.effectsVolume); sound.applyVolume(); });
  $('mute').addEventListener('click', () => { sound.muted = !sound.muted; storage.write('muted', sound.muted); sound.applyVolume(); if (!sound.muted && sound.active && state !== 'paused') sound.resume(); });
  $('audioRecover').addEventListener('click', () => { if (state !== 'paused') sound.resume(true); });
  $('retryEffects').addEventListener('click', () => {
    // Preparing future effects never grants playback intent or resumes a paused context.
    for (const key of ['failure', 'cheer']) {
      if (sound.context) sound.prepareEffect(key, true); else sound.readEffect(key, true).catch(() => {});
    }
  });
  canvas.addEventListener('pointerdown', event => { if (event.isPrimary && (event.pointerType !== 'mouse' || event.button === 0)) { event.preventDefault(); flap(); } });
  document.addEventListener('keydown', event => {
    if (isDialogOpen() || event.target.tagName === 'INPUT' || event.repeat) return;
    if (event.target.tagName === 'BUTTON' && ['Space', 'Enter'].includes(event.code)) return;
    if (['Space', 'ArrowUp', 'Enter'].includes(event.code)) {
      event.preventDefault();
      if (state === 'over') { sound.resume(); readyRound(); }
      else if (state === 'paused') resumeGame();
      else flap();
    } else if (event.code === 'KeyP' || event.code === 'Escape') {
      event.preventDefault(); if (state === 'paused') resumeGame(); else pauseGame();
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { pauseGame(); sound.pause(); }
    lastFrame = performance.now(); accumulator = 0;
    // No automatic playback on return: the explicit resume gesture is reliable on Safari.
    if (!document.hidden && started && !['paused', 'loading'].includes(state)) { sound.blocked = true; sound.sync(); }
  });

  function cover(image, x, y, w, h) {
    const scale = Math.max(w / image.width, h / image.height);
    const dw = image.width * scale, dh = image.height * scale;
    ctx.drawImage(image, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  }
  const earth = document.createElement('canvas'); earth.width = earth.height = 180;
  (function makeEarth() {
    const e = earth.getContext('2d'); e.translate(90, 90);
    const halo = e.createRadialGradient(0, 0, 68, 0, 0, 87); halo.addColorStop(0, '#85d4fa85'); halo.addColorStop(1, '#85d4fa00');
    e.fillStyle = halo; e.beginPath(); e.arc(0, 0, 87, 0, Math.PI * 2); e.fill();
    e.save(); e.beginPath(); e.arc(0, 0, 70, 0, Math.PI * 2); e.clip();
    const ocean = e.createRadialGradient(-32, -28, 2, 12, 15, 95); ocean.addColorStop(0, '#79c3dd'); ocean.addColorStop(.45, '#2a77a9'); ocean.addColorStop(1, '#031c40');
    e.fillStyle = ocean; e.fillRect(-80, -80, 160, 160);
    e.fillStyle = '#8faea0';
    e.beginPath(); e.moveTo(-10, -55); e.lineTo(8,-63); e.lineTo(30,-48); e.lineTo(45,-42); e.lineTo(53,-19); e.lineTo(32,-13); e.lineTo(19,0); e.lineTo(8,-9); e.lineTo(-4,2); e.lineTo(-18,-4); e.lineTo(-26,-22); e.lineTo(-18,-34); e.lineTo(-26,-39); e.closePath(); e.fill();
    e.beginPath(); e.moveTo(-16,1); e.lineTo(11,7); e.lineTo(19,26); e.lineTo(7,46); e.lineTo(-2,56); e.lineTo(-10,40); e.lineTo(-17,25); e.lineTo(-26,12); e.closePath(); e.fill();
    e.beginPath(); e.moveTo(32,34); e.lineTo(57,26); e.lineTo(69,43); e.lineTo(49,55); e.lineTo(35,48); e.closePath(); e.fill();
    e.fillStyle='#d0d6c4'; e.beginPath(); e.ellipse(-6,-64,35,7,.12,0,Math.PI*2); e.fill();
    e.strokeStyle='#e4f1ebbb'; e.lineCap='round'; e.lineWidth=5;
    for (const c of [[-25,-40,42,8,.1],[-35,15,20,5,-.4],[20,14,32,7,-.15],[10,50,39,5,.12]]) { e.beginPath(); e.ellipse(...c, .3, Math.PI*1.4); e.stroke(); }
    const shadow=e.createLinearGradient(-65,-35,52,30); shadow.addColorStop(0,'#00112600'); shadow.addColorStop(.48,'#00112606'); shadow.addColorStop(.82,'#0011269e'); shadow.addColorStop(1,'#000919f5');
    e.fillStyle=shadow; e.fillRect(-80,-80,160,160); e.restore();
    e.strokeStyle='#b1e6ff99'; e.lineWidth=1.4; e.beginPath(); e.arc(0,0,70,Math.PI*.75,Math.PI*1.65); e.stroke();
  })();

  const nox = document.createElement('canvas'); nox.width = nox.height = 180;
  (function makeNox() {
    const e=nox.getContext('2d');e.translate(90,90);
    const halo=e.createRadialGradient(0,0,68,0,0,86);halo.addColorStop(0,'#a9f0d9b0');halo.addColorStop(1,'#88e3d500');
    e.fillStyle=halo;e.beginPath();e.arc(0,0,86,0,Math.PI*2);e.fill();
    e.save();e.beginPath();e.arc(0,0,70,0,Math.PI*2);e.clip();
    const sea=e.createRadialGradient(-30,-34,5,20,20,98);sea.addColorStop(0,'#62cee4');sea.addColorStop(.48,'#268bae');sea.addColorStop(1,'#124663');
    e.fillStyle=sea;e.fillRect(-72,-72,144,144);
    const land=e.createLinearGradient(-60,-50,60,60);land.addColorStop(0,'#a3cd82');land.addColorStop(.45,'#58af78');land.addColorStop(1,'#23765a');e.fillStyle=land;
    e.beginPath();e.moveTo(-62,-47);e.bezierCurveTo(-32,-76,-3,-65,2,-42);e.bezierCurveTo(22,-34,3,-21,-10,-20);e.bezierCurveTo(-11,0,-36,2,-30,24);e.bezierCurveTo(-38,42,-63,19,-55,-5);e.bezierCurveTo(-82,-15,-74,-34,-62,-47);e.fill();
    e.beginPath();e.moveTo(20,-37);e.bezierCurveTo(55,-55,80,-19,67,7);e.bezierCurveTo(47,20,58,48,30,58);e.bezierCurveTo(17,62,22,34,8,22);e.bezierCurveTo(-7,8,18,-9,20,-37);e.fill();
    e.beginPath();e.ellipse(-14,53,17,7,-.5,0,Math.PI*2);e.ellipse(12,-59,8,4,.6,0,Math.PI*2);e.fill();
    e.strokeStyle='#f3fff2a8';e.lineWidth=4;e.lineCap='round';
    for(const cloud of [[-21,-41,40,9,-.3],[22,-10,45,9,-.18],[-18,36,36,8,-.3]]){e.beginPath();e.ellipse(...cloud,.15,Math.PI*1.1);e.stroke();}
    const shade=e.createLinearGradient(-52,-45,58,35);shade.addColorStop(0,'#0e344500');shade.addColorStop(.5,'#0e344510');shade.addColorStop(1,'#0d283dc9');e.fillStyle=shade;e.fillRect(-72,-72,144,144);e.restore();
    e.strokeStyle='#d8fff2aa';e.lineWidth=1.2;e.beginPath();e.arc(0,0,70,Math.PI*.8,Math.PI*1.7);e.stroke();
  })();

  const distantChichibei = [
    {x:73,y:320,height:78,alpha:.34,angle:-.42,spin:.070,phase:.3,seed:431},
    {x:386,y:450,height:62,alpha:.28,angle:.8,spin:-.056,phase:1.8,seed:829},
    {x:42,y:676,height:52,alpha:.24,angle:2.2,spin:.082,phase:3.2,seed:1373},
    {x:389,y:650,height:68,alpha:.30,angle:-1.4,spin:-.064,phase:4.7,seed:2063},
  ];
  function driftNoise(time,seed) {
    const index=Math.floor(time),p=time-index,base=Math.imul(seed,0x85ebca6b);
    // Smooth random control points: no frame-by-frame jitter or fixed orbit.
    const blend=p*p*p*(p*(p*6-15)+10);
    const a=C.seededRandom(base^Math.imul(index+1,0x9e3779b9))()*2-1;
    const b=C.seededRandom(base^Math.imul(index+2,0x9e3779b9))()*2-1;
    return a+(b-a)*blend;
  }
  function drawDistantChichibei() {
    const time=reducedMotion?0:clock;
    for(const actor of distantChichibei){
      const w=actor.height*images.chichibei.width/images.chichibei.height;
      const radius=Math.hypot(w,actor.height)/2+5;
      const centerX=C.clamp(actor.x,radius+38,C.W-radius-38);
      const x=centerX+driftNoise(time/14+actor.phase,actor.seed)*30+driftNoise(time/6+actor.phase,actor.seed+17)*8;
      const y=actor.y+driftNoise(time/18+actor.phase,actor.seed+31)*50+driftNoise(time/8+actor.phase,actor.seed+53)*12;
      const angle=actor.angle+time*actor.spin+driftNoise(time/18+actor.phase,actor.seed+79)*.16;
      ctx.save();ctx.globalAlpha*=actor.alpha;ctx.translate(x,y);ctx.rotate(angle);
      ctx.drawImage(images.chichibei,-w/2,-actor.height/2,w,actor.height);ctx.restore();
    }
  }
  function drawSpace(movement = 0, alpha = 1) {
    ctx.save(); ctx.globalAlpha = alpha;
    cover(images.blue, -8 - Math.sin(clock * .035) * 4, -10, C.W + 20, C.H + 20);
    const mix = state === 'menu' ? .08 : Math.min(.95, Math.max(0, movement / 6800));
    if (mix > 0) { ctx.globalAlpha = alpha * mix; cover(images.rose, -7, -10, C.W + 20, C.H + 20); }
    ctx.globalAlpha = alpha;
    for (const star of stars) {
      const x = ((star.x - movement * star.depth * .21 - clock * (reducedMotion ? 0 : star.depth * 1.8)) % C.W + C.W) % C.W;
      ctx.fillStyle = `rgba(205,229,250,${.25 + .35 * (1 + Math.sin(clock * .7 + star.phase)) / 2})`;
      ctx.beginPath(); ctx.arc(x, star.y, star.r, 0, Math.PI * 2); ctx.fill();
    }
    drawDistantChichibei();
    const planetY = state === 'menu' ? 249 : 186;
    ctx.drawImage(earth, 312, planetY - 30, 64, 64);
    ctx.restore();
  }
  function drawHead(x, y, size, angle = 0, glow = 0) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(angle);
    if (glow > .01) {
      const halo = ctx.createRadialGradient(-8, 0, 8, -8, 0, size * .65);
      halo.addColorStop(0, `rgba(116,188,231,${glow * .16})`); halo.addColorStop(1, '#74bce700');
      ctx.fillStyle = halo; ctx.fillRect(-size, -size, size * 2, size * 2);
    }
    ctx.drawImage(images.head, -size * .64, -size * .63, size, size);
    ctx.restore();
  }
  function drawRocket(object, angle = 0, exhaust = false) {
    ctx.save(); ctx.translate(object.x, object.y); ctx.rotate(angle); if (object.flip) ctx.scale(1, -1);
    if (exhaust) {
      // Pixel-measured nozzle mouths on the 1024x1536 source, in sprite-local
      // coordinates. The side-mounted shuttle exits much higher than boosters.
      const nozzles = [[.312,.932,.038],[.369,.928,.024],[.450,.930,.041],[.509,.929,.026],[.596,.938,.035],[.618,.842,.026],[.672,.845,.025]];
      for (const [nx,ny,width] of nozzles) {
        const x = object.w * (nx-.5), y = object.h * (ny-.5)-1;
        const jitter = reducedMotion ? 0 : Math.sin(clock * 40 + nx*31) * .015;
        const length = object.h * (.21 + jitter) * (width/.035), radius=object.w*width;
        const fire = ctx.createLinearGradient(0, y, 0, y + length);
        fire.addColorStop(0, '#fff9d2'); fire.addColorStop(.3, '#ffd471'); fire.addColorStop(.75, '#ed793780'); fire.addColorStop(1, '#cf523000');
        ctx.fillStyle = fire; ctx.beginPath(); ctx.moveTo(x - radius, y);
        ctx.bezierCurveTo(x - radius*1.3, y + length * .35, x + radius*.4, y + length * .65, x, y + length);
        ctx.bezierCurveTo(x - radius*.4, y + length * .65, x + radius*1.3, y + length * .35, x + radius, y); ctx.closePath(); ctx.fill();
      }
    }
    ctx.drawImage(images.rocket, -object.w / 2, -object.h / 2, object.w, object.h);
    ctx.restore();
  }
  function drawSatellite(object) {
    const { x, y, h } = object;
    ctx.save(); ctx.translate(x, y);
    ctx.fillStyle = '#8b9ba6'; ctx.fillRect(-39, -5, 78, 10);
    for (const side of [-1, 1]) {
      const left = side === -1 ? -63 : 23;
      ctx.fillStyle = '#c4ae86'; ctx.fillRect(left - 2, -h / 2, 43, h);
      const panel = ctx.createLinearGradient(left, 0, left + 39, 0); panel.addColorStop(0, '#1b3b69'); panel.addColorStop(.55, '#315e8d'); panel.addColorStop(1, '#162a50');
      ctx.fillStyle = panel; ctx.fillRect(left + 1, -h / 2 + 4, 37, h - 8);
      ctx.strokeStyle = '#97bac659'; ctx.lineWidth = .7;
      for (let py = -h / 2 + 5; py < h / 2 - 3; py += 19) { ctx.beginPath(); ctx.moveTo(left + 2, py); ctx.lineTo(left + 37, py); ctx.stroke(); }
      for (let px = left + 10; px < left + 38; px += 9) { ctx.beginPath(); ctx.moveTo(px, -h / 2 + 4); ctx.lineTo(px, h / 2 - 4); ctx.stroke(); }
      ctx.strokeStyle = '#e4c992'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(left, 0); ctx.lineTo(left + 39, 0); ctx.stroke();
    }
    const foil = ctx.createLinearGradient(-19, 0, 19, 0); foil.addColorStop(0, '#937148'); foil.addColorStop(.2, '#dfc18a'); foil.addColorStop(.6, '#b3935a'); foil.addColorStop(1, '#73553b');
    ctx.fillStyle = foil; ctx.strokeStyle = '#edcf95'; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(-16,-37);ctx.lineTo(16,-37);ctx.lineTo(20,30);ctx.lineTo(11,39);ctx.lineTo(-17,34);ctx.closePath();ctx.fill();ctx.stroke();
    ctx.strokeStyle = '#674928'; ctx.lineWidth = 1; ctx.beginPath();ctx.moveTo(-12,-30);ctx.lineTo(12,0);ctx.lineTo(-12,29);ctx.moveTo(12,-29);ctx.lineTo(-12,0);ctx.lineTo(12,28);ctx.stroke();
    ctx.fillStyle = '#cad6da'; ctx.fillRect(-9,-43,18,9); ctx.strokeStyle='#a5c7d7';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(0,-43);ctx.lineTo(0,-72);ctx.stroke();
    ctx.fillStyle='#e2e5de';ctx.beginPath();ctx.ellipse(0,-68,15,8,-.25,0,Math.PI);ctx.fill();
    ctx.fillStyle = '#df8977';ctx.beginPath();ctx.arc(0,0,3,0,Math.PI*2);ctx.fill();ctx.restore();
  }
  function drawAsteroid(object) {
    const local = C.seededRandom(object.seed + 900);
    ctx.save();ctx.translate(object.x,object.y);ctx.rotate(object.seed*.72);
    const rock = ctx.createRadialGradient(-17,-19,3,6,8,60);rock.addColorStop(0,'#a69e91');rock.addColorStop(.35,'#736e68');rock.addColorStop(1,'#2c3037');
    ctx.fillStyle=rock;ctx.strokeStyle='#c6c1ae77';ctx.lineWidth=1.1;ctx.beginPath();
    for(let i=0;i<13;i++){const angle=i/13*Math.PI*2;const radius=object.r*(.92+local()*.15);const x=Math.cos(angle)*radius,y=Math.sin(angle)*radius;i?ctx.lineTo(x,y):ctx.moveTo(x,y);}ctx.closePath();ctx.fill();ctx.stroke();
    for(let i=0;i<5;i++){const x=(local()-.5)*48,y=(local()-.5)*48,r=4+local()*7;ctx.fillStyle='#242a324f';ctx.beginPath();ctx.ellipse(x,y,r,r*.72,local()*3,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#c8bd9f36';ctx.beginPath();ctx.arc(x,y+1,r,.1,2.4);ctx.stroke();}
    ctx.restore();
  }
  function drawMenu() {
    drawSpace();
    ctx.save();ctx.translate(226,402);ctx.rotate(-.21);
    ctx.strokeStyle='#b5d0e031';ctx.lineWidth=1;ctx.beginPath();ctx.ellipse(0,0,162,49,0,0,Math.PI*2);ctx.stroke();
    ctx.strokeStyle='#dfbd8040';ctx.beginPath();ctx.ellipse(0,0,174,57,0,.18,1.10);ctx.stroke();
    const orbitAngle=reducedMotion?2:clock*.22;ctx.fillStyle='#e9cb96';ctx.beginPath();ctx.arc(Math.cos(orbitAngle)*162,Math.sin(orbitAngle)*49,3,0,Math.PI*2);ctx.fill();ctx.restore();
    const bob=reducedMotion?0:Math.sin(clock*1.25)*8;
    drawHead(244,402+bob,198,-.05+Math.sin(clock*.7)*.025,.8);
    drawRocket({x:65,y:477,w:61,h:116},-.34);
  }
  function launchPose(t) {
    if(t<4)return{x:225,y:518-70*(t/4)**2,w:268,h:420};
    const p=C.clamp((t-4)/3.8,0,1);return{x:225+p*40,y:448-p*174,w:268-p*98,h:420-p*155};
  }
  function drawIntro(t, drawVehicle = true) {
    drawSpace();
    const atmosphere=1-C.clamp((t-3.7)/2.9,0,1);
    if(atmosphere>0){ctx.save();ctx.globalAlpha=atmosphere;const sky=ctx.createLinearGradient(0,0,0,800);sky.addColorStop(0,'#162b48');sky.addColorStop(.56,'#718b9e');sky.addColorStop(1,'#d6bba1');ctx.fillStyle=sky;ctx.fillRect(0,0,450,800);
      const camera=Math.min(420,t*t*10);ctx.translate(0,camera);
      ctx.fillStyle='#344354';ctx.fillRect(0,713,450,90);ctx.fillStyle='#4b5964';ctx.fillRect(75,694,300,20);
      for(const side of[0,1]){const x=side?325:75;ctx.fillStyle='#566474';ctx.fillRect(x,280,11,416);ctx.fillRect(x+38,280,9,416);ctx.strokeStyle='#76818a';ctx.lineWidth=4;for(let y=290;y<685;y+=50){ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+45,y+44);ctx.lineTo(x,y+44);ctx.stroke();}ctx.fillStyle='#83949f';ctx.fillRect(x-6,348,58,8);ctx.fillRect(x-6,477,58,8);}
      ctx.fillStyle='#566575';ctx.fillRect(0,651,65,62);ctx.fillRect(380,633,70,80);
      for(let i=0;i<12;i++){const px=(i*53+40)%500-25,py=720-Math.sin(i*3+t)*12,r=26+(t*12+i*7)%70;ctx.fillStyle=`rgba(229,221,210,${.16+Math.sin(i)*.03})`;ctx.beginPath();ctx.arc(px,py,r,0,Math.PI*2);ctx.fill();}ctx.restore();}
    if(!drawVehicle)return;
    if(t<EXPLODE_AT){const pose=launchPose(t);drawRocket(pose,t>4?(t-4)*.047:0,true);if(t>5.7){ctx.strokeStyle='#f3dca38c';ctx.lineWidth=2;const strength=Math.sin(t*32);ctx.beginPath();ctx.moveTo(pose.x+30,pose.y);ctx.lineTo(pose.x+43,pose.y-7*strength);ctx.lineTo(pose.x+52,pose.y+10);ctx.stroke();}}
    else{
      const age=t-EXPLODE_AT, origin=launchPose(EXPLODE_AT);
      if(age<2.4){ctx.save();ctx.globalAlpha=Math.max(0,1-age/2.4);const radius=35+age*125;const blast=ctx.createRadialGradient(origin.x,origin.y,0,origin.x,origin.y,radius);blast.addColorStop(0,'#fff2c7');blast.addColorStop(.15,'#ffd079');blast.addColorStop(.45,'#e0834560');blast.addColorStop(1,'#70414700');ctx.fillStyle=blast;ctx.fillRect(origin.x-radius,origin.y-radius,radius*2,radius*2);ctx.restore();}
      for(const piece of debris){const x=origin.x+Math.cos(piece.angle)*piece.speed*age,y=origin.y+Math.sin(piece.angle)*piece.speed*age+age*age*6;ctx.save();ctx.translate(x,y);ctx.rotate(age*piece.spin);ctx.globalAlpha=Math.max(0,1-age/7);ctx.fillStyle=piece.size>7?'#a9a6a0':'#ffc683';ctx.fillRect(-piece.size/2,-2,piece.size,4+piece.size*.3);ctx.restore();}
      if(age>.22){const p=C.clamp((age-.22)/4.3,0,1),ease=1-(1-p)**3;let x=origin.x+(185-origin.x)*ease,y=origin.y+(420-origin.y)*ease-Math.sin(p*Math.PI)*100;const settle=C.clamp((age-4.5)/2,0,1);x+=(114-x)*settle;y+=(400-y)*settle;drawHead(x,y,94+(1-p)*6,(reducedMotion?0:(1-p)**2*Math.PI*4)-.05*settle,.8);}
      if(age<.18&&!reducedMotion){ctx.fillStyle=`rgba(255,225,161,${(1-age/.18)*.48})`;ctx.fillRect(0,0,450,800);}
    }
  }
  const smooth = p => { p=C.clamp(p,0,1); return p*p*(3-2*p); };
  function landingY(t) {
    const segments=[[12,13.4,260,418,72,133],[13.4,14.8,418,480,133,24],[14.8,19.4,480,638,24,27],[19.4,TOUCHDOWN_AT,638,659,27,0]];
    for(const [a,b,y0,y1,v0,v1] of segments)if(t<=b){
      const p=C.clamp((t-a)/(b-a),0,1),p2=p*p,p3=p2*p;
      return (2*p3-3*p2+1)*y0+(p3-2*p2+p)*(b-a)*v0+(-2*p3+3*p2)*y1+(p3-p2)*(b-a)*v1;
    }
    return 659;
  }
  function landingPose(t) {
    const u=Math.max(0,t-12), age=Math.max(0,t-TOUCHDOWN_AT), descent=1-smooth(u/8.5);
    const wind=reducedMotion?0:Math.sin(u*1.05)*20*descent;
    const swing=reducedMotion?0:Math.sin((u-1.4)*2.3)*.125*smooth((u-.5)/1.4)*descent;
    const x=225-30*descent+wind;
    // Zero velocity at contact, then a small compression of the landing gear.
    const compression=reducedMotion?0:3.5*Math.sin(Math.min(age/.65,1)*Math.PI)**2*Math.exp(-age*2);
    return {x,y:landingY(t)+compression,tilt:swing,canopyX:x-Math.sin(swing)*118,age:t-TOUCHDOWN_AT};
  }
  function drawCelebration(age) {
    if(age<0||age>6)return;
    const random=C.seededRandom(20261008), colors=['#e95767','#f2c25c','#76cfda','#faedd5','#ae91da'];
    const count=reducedMotion?30:100;
    for(let i=0;i<count;i++) {
      const side=i%2, delay=(i%3)*.18, a=age-delay;
      const vx=(55+random()*135)*(side?-1:1),vy=-220-random()*180;
      const size=2+random()*3,phase=random()*6.28, spin=(random()-.5)*8;
      if(a<0)continue;
      const x=(side?422:28)+vx*a+Math.sin(a*4+phase)*a*6;
      const y=711+vy*a+70*a*a;
      if(y>740)continue;
      ctx.save();ctx.translate(x,y);ctx.rotate(spin*a);
      ctx.globalAlpha=Math.min(1,(6-age)/.9);ctx.fillStyle=colors[(i+Math.floor(i/5))%colors.length];ctx.strokeStyle=ctx.fillStyle;
      if(i%5===0){
        ctx.lineWidth=size*.65;ctx.beginPath();ctx.moveTo(0,0);
        for(let k=1;k<=12;k++)ctx.lineTo(Math.sin(k*.75+a*5+phase)*5,k*2.4);
        ctx.stroke();
      }else{ctx.scale(Math.cos(a*9+phase),1);ctx.fillRect(-size,-size*.5,size*2,size);}
      ctx.restore();
    }
  }
  function drawLanding(t) {
    const p=C.clamp((t-12)/(TOUCHDOWN_AT-12),0,1), age=t-TOUCHDOWN_AT;
    const sky=ctx.createLinearGradient(0,0,0,800);
    sky.addColorStop(0,'#3c526c');sky.addColorStop(.58,'#a6c0d0');sky.addColorStop(1,'#e5e5df');
    ctx.fillStyle=sky;ctx.fillRect(0,0,450,800);
    ctx.drawImage(nox,316,184,82,82);
    ctx.fillStyle='#e1f0e9';ctx.font='11px "Microsoft YaHei",sans-serif';ctx.textAlign='center';ctx.fillText('诺克斯',357,278);
    for(let i=0;i<6;i++){
      const x=(i*113+20+(reducedMotion?0:t*(i%2?1:-1)))%540-45;
      ctx.fillStyle='#e9f0f24a';ctx.beginPath();ctx.ellipse(x,296+(i%3)*104,70,8,-.06,0,Math.PI*2);ctx.fill();
    }
    ctx.fillStyle='#a4b5c5';ctx.beginPath();ctx.moveTo(0,605);ctx.quadraticCurveTo(88,512,166,602);ctx.quadraticCurveTo(312,534,450,576);ctx.lineTo(450,800);ctx.lineTo(0,800);ctx.fill();
    for(let i=0;i<19;i++){
      const x=i*28-21,y=648+(i%4)*9,h=51+(i*37)%78;
      ctx.fillStyle=i%2?'#708695':'#8a9eaa';ctx.fillRect(x-2,y-h,4,h);
      for(let k=0;k<4;k++){
        const top=y-h+k*h*.2,width=h*(.13+k*.045);
        ctx.beginPath();ctx.moveTo(x,top);ctx.lineTo(x-width,top+h*.36);ctx.lineTo(x+width,top+h*.36);ctx.closePath();ctx.fill();
        ctx.strokeStyle='#dce7eb9c';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(x-width*.7,top+h*.29);ctx.lineTo(x,top+3);ctx.lineTo(x+width*.7,top+h*.29);ctx.stroke();
      }
    }
    ctx.fillStyle='#edf3f3';ctx.beginPath();ctx.moveTo(0,696);ctx.quadraticCurveTo(56,655,128,695);ctx.quadraticCurveTo(228,710,328,684);ctx.quadraticCurveTo(401,670,450,693);ctx.lineTo(450,800);ctx.lineTo(0,800);ctx.fill();
    ctx.fillStyle='#c5d5df';ctx.beginPath();ctx.ellipse(70,741,113,18,-.13,0,Math.PI*2);ctx.ellipse(405,744,126,19,.16,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#fafbf4';ctx.beginPath();ctx.ellipse(72,732,118,17,-.13,0,Math.PI*2);ctx.ellipse(410,735,130,18,.16,0,Math.PI*2);ctx.fill();
    const inflation=smooth((t-12.9)/1.7), pull=smooth((t-12.4)/.5), collapse=smooth((age-.25)/2.0);
    const pose=landingPose(t),{x,y,tilt}=pose;
    ctx.fillStyle=`rgba(52,66,79,${.08+p*.2})`;ctx.beginPath();ctx.ellipse(225,710,20+p*39,5+p*7,0,0,Math.PI*2);ctx.fill();
    const billow=reducedMotion?0:Math.sin((t-14.6)*3.5)*.025*smooth((t-14.6)/.4)*(1-smooth((t-14.6)/3));
    const canopyW=252*(.065+.935*inflation)*(1-collapse*.19)*(1+billow);
    const canopyH=126*(.38+.62*inflation)*(1-collapse*.88)*(1-billow);
    const canopyX=pose.canopyX+collapse*110;
    const canopyBottom=y-116+(710-(y-116))*collapse;
    const canopyTop=canopyBottom-canopyH;
    if(t>=12.4){
      // Rim and capsule anchors move with their own sprites. Slack curves only
      // appear after touchdown; airborne cords always remain under tension.
      ctx.save();ctx.globalAlpha=pull;ctx.strokeStyle='#f6efe1';ctx.lineWidth=.85;
      for(let i=-8;i<=8;i++){
        const u=i/8, ax=canopyX+u*canopyW*.47,ay=canopyTop+canopyH*(.97-.23*u*u);
        const bx=x+u*25*Math.cos(tilt)+38*Math.sin(tilt),by=y+u*25*Math.sin(tilt)-38*Math.cos(tilt);
        ctx.beginPath();ctx.moveTo(ax,ay);
        ctx.quadraticCurveTo((ax+bx)/2+collapse*17,(ay+by)/2+collapse*45,bx,by);ctx.stroke();
      }
      ctx.drawImage(images.parachute,canopyX-canopyW/2,canopyTop,canopyW,canopyH);
      if(inflation<.95){
        ctx.globalAlpha=pull*(1-smooth((inflation-.65)/.3));
        const pilotY=canopyTop-22-pull*18;
        ctx.strokeStyle='#fff7dd';ctx.beginPath();ctx.moveTo(canopyX,canopyTop+3);ctx.lineTo(canopyX-9,pilotY+2);ctx.stroke();
        ctx.fillStyle='#e4e8dd';ctx.beginPath();ctx.ellipse(canopyX-9,pilotY,10,7,0,Math.PI,Math.PI*2);ctx.lineTo(canopyX+1,pilotY+2);ctx.lineTo(canopyX-19,pilotY+2);ctx.fill();
      }
      ctx.restore();
    }
    ctx.save();ctx.translate(x,y);ctx.rotate(tilt);ctx.drawImage(images.capsule,-58,-58,116,116);ctx.restore();
    // Short landing jets and snow displaced by the heat shield, then settling.
    if(t>20.22&&age<1.4){
      const dust=C.clamp((t-20.22)/.28,0,1)*C.clamp(1-age/1.4,0,1);
      for(const side of [-1,1]){
        if(age<0){const jet=ctx.createLinearGradient(0,y+37,0,711);jet.addColorStop(0,'#fff6c5');jet.addColorStop(1,'#f2b47200');ctx.fillStyle=jet;ctx.beginPath();ctx.moveTo(x+side*37,y+36);ctx.lineTo(x+side*48,714);ctx.lineTo(x+side*24,714);ctx.fill();}
        for(let i=0;i<6;i++){ctx.fillStyle=`rgba(248,250,246,${dust*(.35-i*.035)})`;ctx.beginPath();ctx.ellipse(225+side*(35+i*14+Math.max(age,0)*30),710-i%2*6,14+i*3,7+i*2,0,0,Math.PI*2);ctx.fill();}
      }
    }
    drawCelebration(age);
  }
  function drawArrival(t) {
    if (t < 4) { drawIntro(t); return; }
    if (t < 12) {
      drawIntro(t, false);
      const p = C.clamp((t - 4) / 6.7, 0, 1), travel = smooth(p);
      const size = 1 - travel * .985;
      const x = 225 + (344 - 225) * travel, y = 448 + (188 - 448) * travel - 35 * 6.7 * (p*p*p-2*p*p+p);
      ctx.save(); ctx.translate(x, y); ctx.scale(size, size);
      drawRocket({ x: 0, y: 0, w: 268, h: 420 }, smooth(p/.3)*.18 + travel * .25, true); ctx.restore();
      if (p > .92) { ctx.fillStyle = `rgba(195,236,255,${(1-p)/.08})`; ctx.beginPath(); ctx.arc(344, 188, 4 + (p - .92) * 50, 0, Math.PI * 2); ctx.fill(); }
    } else drawLanding(t);
    const fade = t >= 11.2 && t < 12 ? (t - 11.2) / .8 : t >= 12 && t < 12.8 ? 1 - (t - 12) / .8 : 0;
    if (fade > 0) { ctx.fillStyle = `rgba(5,16,30,${fade})`; ctx.fillRect(0, 0, 450, 800); }
  }
  function drawRound() {
    drawSpace(game.distance);
    if(state!=='ready' && !(state==='paused' && previousState==='ready')){
      for(const gate of game.gates){for(const object of C.gateObjects(gate)){if(object.kind==='rocket')drawRocket(object);else if(object.kind==='satellite')drawSatellite(object);else drawAsteroid(object);}}
    }
    if(gameTrail.length>1){ctx.save();ctx.lineWidth=2;ctx.strokeStyle='#9bc9e936';ctx.beginPath();gameTrail.forEach((point,index)=>index?ctx.lineTo(point.x,point.y):ctx.moveTo(point.x,point.y));ctx.stroke();ctx.restore();}
    let angle=C.playerAngle(game.player);
    if(state==='ready')angle=-.05;
    if(state==='crash'||state==='over')angle+=Math.min(.5,clock-crashedAt)*1.8;
    drawHead(game.player.x,game.player.y,94,angle,flapGlow);
    if(state==='crash'){const age=clock-crashedAt;for(let i=0;i<7;i++){const a=i/7*Math.PI*2;ctx.fillStyle=`rgba(245,213,158,${Math.max(0,1-age*1.6)})`;ctx.beginPath();ctx.arc(game.player.x+Math.cos(a)*(20+age*85),game.player.y+Math.sin(a)*(20+age*85),2,0,Math.PI*2);ctx.fill();}}
    // Gentle screen-edge shading makes the upper and lower flight limits readable.
    const edge=ctx.createLinearGradient(0,0,0,800);edge.addColorStop(0,'#03091190');edge.addColorStop(.06,'#03091100');edge.addColorStop(.94,'#03091100');edge.addColorStop(1,'#03091190');ctx.fillStyle=edge;ctx.fillRect(0,0,450,800);
    ctx.strokeStyle='#99b1c031';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(0,.5);ctx.lineTo(450,.5);ctx.moveTo(0,799.5);ctx.lineTo(450,799.5);ctx.stroke();
  }
  function tick(now) {
    const sceneDelta=Math.max(0,(now-lastFrame)/1000||0), dt=Math.min(.05,sceneDelta);lastFrame=Math.max(lastFrame,now);
    if(!document.hidden && state!=='loading'){
      if(!isDialogOpen() && state!=='paused'){
        clock+=dt;flapGlow=Math.max(0,flapGlow-dt*2.8);
        if(state==='intro'){
          // Cinematic time follows elapsed foreground time; physics alone is
          // capped. Dropped frames must not stretch the 14.5s musical cue.
          sceneTime+=sceneDelta;
          const caption=captions.find(item=>sceneTime>=item.from&&sceneTime<item.to)?.text||'';
          if(caption!==lastCaption){lastCaption=caption;$('captionText').textContent=caption;$('introCaption').hidden=!caption;}
          if(sceneTime>=EXPLODE_AT&&!explosionPlayed){explosionPlayed=true;sound.tone('explosion');}
          if(sceneTime>=INTRO_END)readyRound();
        }else if(state==='arrival'){
          sceneTime+=sceneDelta;
          const caption = sceneTime < 3.8 ? '安泰宇航，发射。' : sceneTime < 10.8 ? '航线确认。目的地：地球。' : sceneTime < 12.8 ? '' : sceneTime < 14.6 ? '引导伞展开，主伞充气。' : sceneTime < 16 ? '主伞已充气，绳索绷紧。' : sceneTime < 20.5 ? '减速下降，准备着陆。' : '';
          if(caption!==lastCaption){lastCaption=caption;$('captionText').textContent=caption;$('introCaption').hidden=!caption;}
          if(sceneTime>=TOUCHDOWN_AT&&!landingCelebrated){landingCelebrated=true;sound.playCheer();}
          if(sceneTime>=ARRIVAL_END){sceneTime=ARRIVAL_END;setState('success');$('announcement').textContent='返回舱已安全着陆。欢迎回到地球。';}
        }else if(state==='success'){
          sceneTime=Math.min(TOUCHDOWN_AT+6,sceneTime+sceneDelta);
        }else if(state==='playing'){
          accumulator+=dt;
          while(accumulator>=1/120&&game.alive){game.step(1/120);accumulator-=1/120;}
          for(const point of gameTrail)point.x-=dt*145;
          gameTrail.push({x:game.player.x-25,y:game.player.y+9});if(gameTrail.length>17)gameTrail.shift();
          if(game.score!==lastScore){lastScore=game.score;$('score').textContent=game.score;sound.tone('score');}
          if(!game.alive){crashedAt=clock;freshRecord=game.score>best;if(freshRecord){best=game.score;storage.write(modeInfo[mode].record,best);}setState('crash');sound.tone('crash');sound.playFailure();}
        }else if(state==='crash'&&clock-crashedAt>.7)showResult();
      }
      ctx.save();ctx.setTransform(canvas.width/C.W,0,0,canvas.height/C.H,0,0);
      const view=state==='paused'?previousState:state;
      if(view==='menu')drawMenu();else if(view==='intro')drawIntro(sceneTime);else if(view==='arrival'||view==='success')drawArrival(sceneTime);else drawRound();
      ctx.restore();
    }
    requestAnimationFrame(tick);
  }
  let imageGeneration = 0, loadingImages = false, initialized = false;
  function loadImage(src, signal) {
    return new Promise((resolve, reject) => {
      const image = new Image(); let settled = false;
      const finish = error => {
        if (settled) return; settled = true; clearTimeout(timer); image.onload = image.onerror = null; signal.removeEventListener('abort', cancel);
        if (error) { image.src = ''; reject(error); } else resolve(image);
      };
      const cancel = () => finish(new Error('Image attempt cancelled'));
      const timer = setTimeout(() => finish(new Error('Image timeout')), 15000);
      signal.addEventListener('abort', cancel, {once:true});
      image.onload = () => finish(image.naturalWidth ? null : new Error('Image decode failed'));
      image.onerror = () => finish(new Error('Image load/decode failed'));
      image.src = src;
    });
  }
  async function loadImages() {
    if (loadingImages || initialized) return;
    loadingImages = true; const generation = ++imageGeneration, controller = new AbortController(); let count = 0;
    $('retryImages').hidden = true; $('loadingText').textContent = '已加载图片 0/7';
    try {
      const loaded = await Promise.all(Object.entries(A.images).map(async ([key, src]) => {
        const image = images[key] || await loadImage(src, controller.signal);
        if (generation === imageGeneration) { images[key] = image; $('loadingText').textContent = '已加载图片 ' + (++count) + '/7'; }
        return [key, image];
      }));
      if (generation !== imageGeneration || initialized) return;
      images = Object.fromEntries(loaded); initialized = true;
      $('ambient').style.backgroundImage = 'url("' + A.images.blue + '")';
      resize(); selectMode('standard'); setState('menu'); lastFrame = performance.now(); requestAnimationFrame(tick); sound.prefetchEffects();
    } catch (error) {
      controller.abort(); imageGeneration++;
      $('loadingText').textContent = A.delivery === 'online' ? '素材加载失败，请检查网络后重试。若仍失败，请重新加载页面。' : '素材加载失败，请重试或重新打开完整 HTML 文件。';
      $('retryImages').hidden = false; console.warn('Image loading:', error.message);
    } finally { loadingImages = false; }
  }
  $('retryImages').addEventListener('click', loadImages);
  loadImages();
})();
