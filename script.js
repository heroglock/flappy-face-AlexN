
(() => {
  "use strict";

  /* ----------------------------- Utilities ----------------------------- */
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
  const easeInOutSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;

  function nowMs() { return performance.now(); }

  // Circle vs axis-aligned rectangle collision (approx for pipe collision)
  function circleRectCollide(cx, cy, r, rx, ry, rw, rh) {
    const closestX = clamp(cx, rx, rx + rw);
    const closestY = clamp(cy, ry, ry + rh);
    const dx = cx - closestX;
    const dy = cy - closestY;
    return (dx * dx + dy * dy) <= r * r;
  }

  function getGrade(score) {
    if (score < 5) return "новичок 💀";
    if (score < 15) return "лох 🤭";
    if (score < 30) return "летун 🦅";
    if (score < 50) return "задрот 🚀";
    if (score < 80) return "лютейший задрот 🤠";
    return "легенда 🤩";
  }

  /* ----------------------------- DOM UI ----------------------------- */
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d", { alpha: false });

  // Custom bird image (face instead of default bird)
  const birdImg = new Image();
  let birdImgLoaded = false;
  birdImg.onload = () => { birdImgLoaded = true; };
  const FACE_SOURCES = {
    navalny: "faces/navalny.png",
    rem: "faces/rem.png",
  };
  function setFace(id, persist) {
    const faceId = Object.prototype.hasOwnProperty.call(FACE_SOURCES, id) ? id : "navalny";
    birdImgLoaded = false;
    birdImg.src = FACE_SOURCES[faceId];
    if (persist) localStorage.setItem(FACE_KEY, faceId);
    if (faceSelect) faceSelect.value = faceId;
    if (faceSelect2) faceSelect2.value = faceId;
  }

  const menuScreen = document.getElementById("menuScreen");
  const overScreen = document.getElementById("overScreen");
  const startBtn = document.getElementById("startBtn");
  const restartBtn = document.getElementById("restartBtn");

  const bestTop = document.getElementById("bestTop");
  const currentTop = document.getElementById("currentTop");
  const currentPill = document.getElementById("currentPill");
  const bestPill = document.getElementById("bestPill");

  const soundSwitch = document.getElementById("soundSwitch");
  const soundSwitch2 = document.getElementById("soundSwitch2");
  const faceSelect = document.getElementById("faceSelect");
  const faceSelect2 = document.getElementById("faceSelect2");
  const gradeEl = document.getElementById("gradeEl");

  const BEST_KEY = "flappy_best_v1";
  const SOUND_KEY = "flappy_sound_v1";
  const FACE_KEY = "flappy_face_v1";
  const FACE_INIT_KEY = "flappy_face_initialized_v1";

  function getBest() {
    const v = Number(localStorage.getItem(BEST_KEY));
    return Number.isFinite(v) ? v : 0;
  }
  function setBest(v) {
    localStorage.setItem(BEST_KEY, String(Math.max(0, v | 0)));
  }

  let bestScore = getBest();
  bestTop.textContent = bestScore;
  bestPill.textContent = bestScore;
  currentPill.textContent = 0;
  currentTop.textContent = 0;

  const faceInitialized = localStorage.getItem(FACE_INIT_KEY) === "1";
  if (!faceInitialized) {
    // On first launch always default to Navalny.
    setFace("navalny", true);
    localStorage.setItem(FACE_INIT_KEY, "1");
  } else {
    const savedFaceId = localStorage.getItem(FACE_KEY);
    setFace(savedFaceId || "navalny", false);
  }
  if (faceSelect) {
    faceSelect.addEventListener("change", () => {
      setFace(faceSelect.value, true);
    });
  }
  if (faceSelect2) {
    faceSelect2.addEventListener("change", () => {
      setFace(faceSelect2.value, true);
    });
  }

  function setScreen(state) {
    // Smooth transitions are handled with CSS class toggles.
    if (state === "menu") {
      menuScreen.classList.add("on");
      overScreen.classList.remove("on");
    } else if (state === "over") {
      menuScreen.classList.remove("on");
      overScreen.classList.add("on");
    } else {
      menuScreen.classList.remove("on");
      overScreen.classList.remove("on");
    }
  }

  /* ----------------------------- Sound System (Web Audio) ----------------------------- */
  class SoundSystem {
    constructor() {
      this.enabled = true;
      this.ctx = null;
      this.master = null;
      this.lastUserGestureAt = 0;
      this._initFromStorage();
    }

    _initFromStorage() {
      const raw = localStorage.getItem(SOUND_KEY);
      if (raw === null) {
        this.enabled = true;
      } else {
        this.enabled = raw === "1";
      }
      this._syncSwitchUI();
    }

    _syncSwitchUI() {
      const set = (el, on) => {
        el.classList.toggle("on", on);
        el.setAttribute("aria-checked", String(on));
      };
      set(soundSwitch, this.enabled);
      set(soundSwitch2, this.enabled);
    }

    async ensure() {
      if (!this.ctx) {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.65;
        this.master.connect(this.ctx.destination);
      }
      if (this.ctx.state === "suspended") {
        await this.ctx.resume();
      }
    }

    setEnabled(on) {
      this.enabled = !!on;
      localStorage.setItem(SOUND_KEY, this.enabled ? "1" : "0");
      this._syncSwitchUI();
    }

    _playTone({ t = 0, duration = 0.08, freq = 440, type = "triangle", gain = 0.35, detune = 0, rampTo = 0.0001, filterFreq = null }) {
      if (!this.enabled) return;
      if (!this.ctx) return;

      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      let node = osc;

      if (filterFreq) {
        const filt = this.ctx.createBiquadFilter();
        filt.type = "lowpass";
        filt.frequency.value = filterFreq;
        osc.connect(filt);
        node = filt;
      }

      node.connect(g);
      g.connect(this.master);

      osc.type = type;
      osc.frequency.setValueAtTime(freq, this.ctx.currentTime + t);
      if (detune) osc.detune.setValueAtTime(detune, this.ctx.currentTime + t);

      const startAt = this.ctx.currentTime + t;
      const endAt = startAt + duration;

      g.gain.setValueAtTime(gain, startAt);
      g.gain.exponentialRampToValueAtTime(Math.max(rampTo, 0.00001), endAt);

      osc.start(startAt);
      osc.stop(endAt);
    }

    _playNoiseBurst({ t = 0, duration = 0.18, gain = 0.35, color = "white", filterFreq = 900, decay = 0.0001 }) {
      if (!this.enabled) return;
      if (!this.ctx) return;

      // Generate noise buffer quickly
      const sampleRate = this.ctx.sampleRate;
      const length = Math.max(1, Math.floor(sampleRate * duration));
      const buffer = this.ctx.createBuffer(1, length, sampleRate);
      const data = buffer.getChannelData(0);

      for (let i = 0; i < length; i++) {
        let v = Math.random() * 2 - 1;
        if (color === "pink") {
          // crude pink-ish shaping by smoothing
          v = (v + (i > 0 ? data[i - 1] : 0) * 0.3) / 1.3;
        }
        data[i] = v;
      }

      const src = this.ctx.createBufferSource();
      src.buffer = buffer;

      const filter = this.ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = filterFreq;
      filter.Q.value = 0.8;

      const g = this.ctx.createGain();
      g.gain.setValueAtTime(gain, this.ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(Math.max(decay, 0.00001), this.ctx.currentTime + t + duration);

      src.connect(filter);
      filter.connect(g);
      g.connect(this.master);

      const startAt = this.ctx.currentTime + t;
      src.start(startAt);
      src.stop(startAt + duration + 0.02);
    }

    // Short "flap"
    async flap() {
      if (!this.enabled) return;
      await this.ensure();
      this._playTone({ duration: 0.06, t: 0, freq: 520, type: "triangle", gain: 0.22, detune: -20, rampTo: 0.0001, filterFreq: 1200 });
    }

    async score() {
      if (!this.enabled) return;
      await this.ensure();
      this._playTone({ duration: 0.09, t: 0, freq: 880, type: "sine", gain: 0.22, detune: 15, rampTo: 0.0001, filterFreq: 2000 });
      this._playTone({ duration: 0.06, t: 0.02, freq: 1320, type: "triangle", gain: 0.14, detune: -5, rampTo: 0.0001, filterFreq: 3200 });
    }

    async hit() {
      if (!this.enabled) return;
      await this.ensure();
      // Buzz + low thump
      this._playTone({ duration: 0.14, t: 0, freq: 160, type: "square", gain: 0.18, detune: -30, rampTo: 0.0001, filterFreq: 500 });
      this._playNoiseBurst({ duration: 0.12, t: 0.01, gain: 0.10, filterFreq: 280, decay: 0.0001, color: "white" });
    }

    async explosion() {
      if (!this.enabled) return;
      await this.ensure();

      // Bigger noise + tones
      this._playNoiseBurst({ duration: 0.22, t: 0, gain: 0.28, filterFreq: 700, decay: 0.0001, color: "white" });
      this._playNoiseBurst({ duration: 0.28, t: 0.02, gain: 0.18, filterFreq: 220, decay: 0.0001, color: "pink" });

      this._playTone({ duration: 0.12, t: 0.01, freq: 110, type: "sawtooth", gain: 0.16, detune: -10, rampTo: 0.0001, filterFreq: 420 });
      this._playTone({ duration: 0.10, t: 0.03, freq: 190, type: "triangle", gain: 0.12, detune: 10, rampTo: 0.0001, filterFreq: 600 });
    }
  }

  const sound = new SoundSystem();

  function toggleSwitch(el) {
    const on = el.classList.contains("on");
    sound.setEnabled(!on);
  }
  soundSwitch.addEventListener("click", async () => { toggleSwitch(soundSwitch); await sound.ensure().catch(() => { }); });
  soundSwitch2.addEventListener("click", async () => { toggleSwitch(soundSwitch2); await sound.ensure().catch(() => { }); });

  soundSwitch.addEventListener("keydown", async (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggleSwitch(soundSwitch);
      await sound.ensure().catch(() => { });
    }
  });
  soundSwitch2.addEventListener("keydown", async (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggleSwitch(soundSwitch2);
      await sound.ensure().catch(() => { });
    }
  });

  /* ----------------------------- Game Constants ----------------------------- */
  let W = 900, H = 540; // virtual dimensions; will be resized
  let dpr = 1;

  const PIPE = {
    width: 76,
    gapMin: 138,
    gapMax: 188,
    spawnEvery: 1.45, // seconds (base)
    speedBase: 260, // px/s
    speedMax: 370,
    marginTop: 90,
    marginBottom: 92
  };

  const GROUND = {
    height: 78
  };

  const BIRD = {
    radius: 15,
    xRatio: 0.28,
    gravity: 1500,     // px/s^2
    jumpVel: -420,     // px/s
    maxFall: 850
  };

  const BG = {
    // Parallax cloud/stars speeds are fractions of pipe speed
    cloud1: 0.12,
    cloud2: 0.22,
    stars: 0.36
  };

  /* ----------------------------- Background (Parallax) ----------------------------- */
  const bg = {
    clouds: [],
    stars: [],
    offset: 0,
    seeded: false
  };

  function mulberry32(seed) {
    let t = seed >>> 0;
    return function () {
      t += 0x6D2B79F5;
      let x = Math.imul(t ^ (t >>> 15), 1 | t);
      x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }

  function seedBackground() {
    // Seed based on size to keep stable across resizes.
    const seed = Math.floor(W * 1000 + H * 10);
    const rnd = mulberry32(seed);

    bg.clouds = [];
    bg.stars = [];
    bg.offset = 0;

    // Clouds
    for (let i = 0; i < 10; i++) {
      const y = 70 + rnd() * (H * 0.42);
      const size = 55 + rnd() * 75;
      const x = rnd() * W;
      const layer = rnd() < 0.6 ? 1 : 2;
      const speedFactor = layer === 1 ? BG.cloud1 : BG.cloud2;
      bg.clouds.push({
        x, y, size, layer, speedFactor,
        alpha: 0.14 + rnd() * 0.18
      });
    }

    // Stars
    for (let i = 0; i < 110; i++) {
      bg.stars.push({
        x: rnd() * W,
        y: rnd() * (H * 0.7),
        r: 0.6 + rnd() * 1.6,
        a: 0.25 + rnd() * 0.55,
        tw: rnd() * Math.PI * 2,
      });
    }
    bg.seeded = true;
  }

  function ensureCanvasSize() {
    const vw = Math.max(320, window.innerWidth || document.documentElement.clientWidth || 320);
    const vh = Math.max(480, window.innerHeight || document.documentElement.clientHeight || 480);

    // Полная адаптация под экран: внутренняя логическая ширина/высота = размеру окна
    W = vw;
    H = vh;

    dpr = Math.max(1, Math.min(2.5, window.devicePixelRatio || 1));

    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    seedBackground();
  }

  window.addEventListener("resize", () => {
    ensureCanvasSize();
    // Keep current gameplay coherent; simplest is to preserve state but re-clamp positions.
    bird.y = clamp(bird.y, BIRD.radius + 10, H - GROUND.height - BIRD.radius - 10);
  });

  /* ----------------------------- Particle System ----------------------------- */
  class ParticleSystem {
    constructor() {
      this.trails = [];     // light persistent trails
      this.explosions = []; // burst particles
      this.meatChunks = []; // bloody meat pieces
      this.flashTimer = 0;
      this.shakeTime = 0;
      this.shakeAmp = 0;
      this.slowMoTime = 0;
      this.baseTimeScale = 1;
    }

    // Spawn two small "tear" particles for continuous flight effect
    spawnTrail(x, y, vx, vy) {
      for (let i = 0; i < 2; i++) {
        const ang = Math.atan2(vy, vx) + Math.PI + (Math.random() - 0.5) * 0.7;
        const sp = 50 + Math.random() * 80;
        const side = i === 0 ? -1 : 1;
        const p = {
          x: x + side * (6 + Math.random() * 3),
          y: y + (Math.random() - 0.5) * 3,
          vx: Math.cos(ang) * sp + vx * -0.25,
          vy: Math.sin(ang) * sp + vy * -0.25,
          life: 0.3 + Math.random() * 0.2,
          t: 0,
          size: 1.2 + Math.random() * 1.8,
          hueShift: (Math.random() - 0.5) * 10
        };
        this.trails.push(p);
      }
    }

    spawnExplosion(x, y) {
      const count = 58 + Math.floor(Math.random() * 18);
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.7;
        // increase speed ~3x to make explosion radius much larger
        const sp = 100 + Math.random() * 10000;
        const p = {
          x, y,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp - 60,
          life: 0.65 + Math.random() * 0.35,
          t: 0,
          size: 2.2 + Math.random() * 4.2,
          spin: (Math.random() - 0.5) * 10,
          sat: 85 + Math.random() * 10,
          lum: 62 + Math.random() * 10,
          // Slightly bias colors toward orange/yellow for "explosion"
          hue: 24 + Math.random() * 18
        };
        this.explosions.push(p);
      }
    }

    // Big bloody meat chunks that fly far across the map
    spawnMeatChunks(x, y) {
      const count = 180 + Math.floor(Math.random() * 100);
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = 128 + Math.random() * 6666;
        const size = 4 + Math.random() * 11;
        const life = 0.9 + Math.random() * 0.7;
        const chunk = {
          x,
          y,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp - 80,
          life,
          t: 0,
          w: size * (0.7 + Math.random() * 0.8),
          h: size * (0.9 + Math.random() * 1.2),
          rot: Math.random() * Math.PI * 2,
          rotVel: (Math.random() - 0.5) * 6,
        };
        this.meatChunks.push(chunk);
      }
    }

    triggerDeathEffects() {
      this.flashTimer = 0.11; // seconds
      this.shakeTime = 0.55;  // seconds
      this.shakeAmp = 7.5;    // pixels
      this.slowMoTime = 0.44; // seconds (brief slow motion)
      this.baseTimeScale = 0.4; // overridden while slowMoTime > 0
    }

    update(dt) {
      // Update timers
      if (this.flashTimer > 0) this.flashTimer = Math.max(0, this.flashTimer - dt);
      if (this.shakeTime > 0) this.shakeTime = Math.max(0, this.shakeTime - dt);
      if (this.slowMoTime > 0) {
        this.slowMoTime = Math.max(0, this.slowMoTime - dt);
      }

      const groundY = H - GROUND.height;

      const collideWithPipes = (o, r, restitution, wallFriction) => {
        // Treat each pipe as two rectangles (top + bottom), collide as circle
        for (const p of state.pipes) {
          const gapTop = p.gapY - p.gap / 2;
          const gapBottom = p.gapY + p.gap / 2;

          const rects = [
            { rx: p.x, ry: 0, rw: p.w, rh: gapTop },
            { rx: p.x, ry: gapBottom, rw: p.w, rh: groundY - gapBottom },
          ];

          for (const R of rects) {
            if (R.rw <= 0 || R.rh <= 0) continue;
            if (!circleRectCollide(o.x, o.y, r, R.rx, R.ry, R.rw, R.rh)) continue;

            // Closest point on rect to circle center
            const cx = o.x, cy = o.y;
            const closestX = clamp(cx, R.rx, R.rx + R.rw);
            const closestY = clamp(cy, R.ry, R.ry + R.rh);
            let dx = cx - closestX;
            let dy = cy - closestY;
            let dist = Math.hypot(dx, dy);

            // If center is inside rect, pick a stable normal to push out
            if (dist < 0.0001) {
              const left = Math.abs(cx - R.rx);
              const right = Math.abs((R.rx + R.rw) - cx);
              const top = Math.abs(cy - R.ry);
              const bottom = Math.abs((R.ry + R.rh) - cy);
              const m = Math.min(left, right, top, bottom);
              if (m === left) { dx = -1; dy = 0; dist = 1; }
              else if (m === right) { dx = 1; dy = 0; dist = 1; }
              else if (m === top) { dx = 0; dy = -1; dist = 1; }
              else { dx = 0; dy = 1; dist = 1; }
            }

            const nx = dx / dist;
            const ny = dy / dist;

            // Push out of the pipe
            const penetration = Math.max(0, r - dist);
            o.x += nx * penetration;
            o.y += ny * penetration;

            // Reflect velocity
            const vn = o.vx * nx + o.vy * ny;
            if (vn < 0) {
              o.vx -= (1 + restitution) * vn * nx;
              o.vy -= (1 + restitution) * vn * ny;

              // Tangential friction on contact
              const tx = -ny, ty = nx;
              const vt = o.vx * tx + o.vy * ty;
              o.vx -= vt * tx * wallFriction;
              o.vy -= vt * ty * wallFriction;
            }
          }
        }
      };

      // Trail particles
      for (let i = this.trails.length - 1; i >= 0; i--) {
        const p = this.trails[i];
        p.t += dt;
        const k = p.t / p.life;
        if (k >= 1) {
          this.trails.splice(i, 1);
          continue;
        }
        // Drag and gravity for a nice smear
        p.vx *= Math.pow(0.001, dt); // strong decay
        p.vy += 120 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }

      // Explosion particles with simple physics (gravity + bounce on ground)
      const gravity = 680;
      for (let i = this.explosions.length - 1; i >= 0; i--) {
        const p = this.explosions[i];
        p.t += dt;
        const k = p.t / p.life;
        if (k >= 1) {
          this.explosions.splice(i, 1);
          continue;
        }
        // air drag
        p.vx *= Math.pow(0.0008, dt);
        p.vy = p.vy * Math.pow(0.002, dt) + gravity * dt * 0.25;
        p.x += p.vx * dt;
        p.y += p.vy * dt;

        // collide with pipes
        collideWithPipes(p, Math.max(1.5, p.size * 0.8), 0.35, 0.35);

        // collide with ground: small bouncy hop, then slide
        if (p.y > groundY) {
          p.y = groundY;
          if (Math.abs(p.vy) > 40) {
            p.vy *= -0.35;
            p.vx *= 0.55;
          } else {
            p.vy = 0;
            p.vx *= 0.8;
          }
        }

        // simple side walls
        if (p.x < 0 || p.x > W) {
          p.x = clamp(p.x, 0, W);
          p.vx *= -0.4;
        }
      }

      // Meat chunks (heavier, fly wide, then fall + bounce)
      const meatGravity = 900;
      for (let i = this.meatChunks.length - 1; i >= 0; i--) {
        const c = this.meatChunks[i];
        c.t += dt;
        const k = c.t / c.life;
        if (k >= 1) {
          this.meatChunks.splice(i, 1);
          continue;
        }
        // air drag
        c.vx *= Math.pow(0.0025, dt);
        c.vy = c.vy * Math.pow(0.003, dt) + meatGravity * dt * 0.55;
        c.x += c.vx * dt;
        c.y += c.vy * dt;
        c.rot += c.rotVel * dt;

        // collide with pipes
        collideWithPipes(c, Math.max(3, Math.max(c.w, c.h) * 0.85), 0.45, 0.22);

        // collide with ground
        if (c.y > groundY) {
          c.y = groundY;
          if (Math.abs(c.vy) > 60) {
            c.vy *= -0.4;
            c.vx *= 0.7;
            c.rotVel *= 0.6;
          } else {
            c.vy = 0;
            c.vx *= 0.85;
            c.rotVel *= 0.4;
          }
        }

        // simple side walls
        if (c.x < 0 || c.x > W) {
          c.x = clamp(c.x, 0, W);
          c.vx *= -0.5;
          c.rotVel *= 0.7;
        }
      }
    }

    getTimeScale() {
      if (this.slowMoTime > 0) return this.baseTimeScale; // 0.3–0.5 range per requirements
      return 1;
    }

    render(ctx, camShakeX, camShakeY) {
      // Trail first
      for (const p of this.trails) {
        const k = p.t / p.life;
        const a = (1 - k) * 0.55;
        const r = p.size * (1 - k * 0.7);
        ctx.save();
        ctx.globalAlpha = a;
        ctx.fillStyle = `rgba(128,216,255,1)`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // Explosion particles
      for (const p of this.explosions) {
        const k = p.t / p.life;
        const a = (1 - k) * 0.95;
        const r = p.size * (1 - k * 0.55);

        ctx.save();
        ctx.globalAlpha = a;
        // Orange/red fire-ish color
        ctx.fillStyle = `hsl(${p.hue} ${p.sat}% ${p.lum}%)`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();

        // Subtle highlight
        ctx.globalAlpha = a * 0.55;
        ctx.fillStyle = `rgba(255,255,255,.95)`;
        ctx.beginPath();
        ctx.arc(p.x - r * 0.22, p.y - r * 0.22, Math.max(0.6, r * 0.45), 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
      }

      // Bloody meat chunks
      for (const c of this.meatChunks) {
        const k = c.t / c.life;
        const a = (1 - k) * 0.98;
        ctx.save();
        ctx.globalAlpha = a;
        ctx.translate(c.x, c.y);
        ctx.rotate(c.rot);

        // main dark red body
        ctx.fillStyle = "#6a050b";
        ctx.beginPath();
        ctx.ellipse(0, 0, c.w, c.h, 0.3, 0, Math.PI * 2);
        ctx.fill();

        // brighter blood highlight
        ctx.fillStyle = "#b3121a";
        ctx.beginPath();
        ctx.ellipse(-c.w * 0.15, -c.h * 0.1, c.w * 0.55, c.h * 0.55, -0.2, 0, Math.PI * 2);
        ctx.fill();

        // tiny bone / fat hint
        if (k < 0.7) {
          ctx.fillStyle = "#f4d5b8";
          ctx.beginPath();
          ctx.arc(c.w * 0.4, -c.h * 0.1, Math.min(c.w, c.h) * 0.25, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.restore();
      }

      // Screen shake is applied as a camera transform outside; here we render flash overlay.
      if (this.flashTimer > 0) {
        const t = this.flashTimer / 0.11;
        const a = clamp(easeOutCubic(1 - t), 0, 1) * 0.32;
        ctx.save();
        ctx.globalAlpha = a;
        ctx.fillStyle = `rgba(255, 240, 220, 1)`;
        ctx.fillRect(-camShakeX, -camShakeY, W + camShakeX * 2, H + camShakeY * 2);
        ctx.restore();
      }
    }
  }

  const particles = new ParticleSystem();

  /* ----------------------------- Game State & Entities ----------------------------- */
  const state = {
    mode: "menu", // "menu" | "playing" | "over"
    score: 0,
    time: 0,
    pipeSpawnTimer: 0,
    pipes: [],
    lastFrameMs: 0,
    startedAtMs: 0,
    inputGuardMs: 0,
  };

  const bird = {
    x: 0,
    y: 0,
    vy: 0,
    r: BIRD.radius,
    wingPhase: 0,
    alive: true,
    tilt: 0,
    scaleX: 1,
    scaleY: 1,
    squashTimer: 0
  };

  function resetGame() {
    state.score = 0;
    state.time = 0;
    state.pipeSpawnTimer = 0;
    state.pipes = [];

    bird.x = Math.floor(W * BIRD.xRatio);
    bird.y = Math.floor(H * 0.46);
    bird.vy = 0;
    bird.wingPhase = 0;
    bird.alive = true;
    bird.tilt = 0;
    bird.scaleX = 1;
    bird.scaleY = 1;
    bird.squashTimer = 0;

    particles.trails.length = 0;
    particles.explosions.length = 0;
    particles.flashTimer = 0;
    particles.shakeTime = 0;
    particles.shakeAmp = 7.5;
    particles.slowMoTime = 0;
    particles.baseTimeScale = 0.4;

    // Spawn first pipes after a short delay to let player react.
    state.pipeSpawnTimer = 0.45;

    // Ensure UI mode
    setScreen("playing");
    state.mode = "playing";
    state.lastFrameMs = nowMs();
    state.startedAtMs = state.lastFrameMs;
  }

  /* ----------------------------- Input Handling ----------------------------- */
  function wantJump() {
    const t = nowMs();
    // Prevent rapid multi-flaps from a single press/hold
    if (t < state.inputGuardMs) return;
    state.inputGuardMs = t + 110;

    if (state.mode === "menu") {
      sound.ensure().catch(() => { });
      resetGame();
      doFlap(true);
      return;
    }
    if (state.mode === "over") {
      sound.ensure().catch(() => { });
      resetGame();
      doFlap(true);
      return;
    }
    if (state.mode === "playing") {
      doFlap(false);
    }
  }

  function doFlap(fromStart) {
    // Squash/stretch micro-animation on jump
    bird.squashTimer = 0.25;
    bird.scaleX = 2;
    bird.scaleY = 0.3;

    // Reset/limit downward velocity slightly for responsive feel
    bird.vy = Math.min(bird.vy, 420);
    bird.vy = BIRD.jumpVel;

    // A slightly different wing motion kick
    bird.wingPhase += 0.7;

    // Jump sound
    if (!fromStart) {
      sound.flap().catch(() => { });
    } else {
      // Still try to flap on start with sound too
      sound.flap().catch(() => { });
    }
  }

  document.addEventListener("keydown", (e) => {
    if (e.code === "Space") {
      e.preventDefault();
      wantJump();
    }
    if (e.code === "KeyR") {
      if (state.mode === "over" || state.mode === "menu") {
        resetGame();
        doFlap(false);
      }
    }
  }, { passive: false });

  // Mouse & Touch
  canvas.addEventListener("mousedown", (e) => {
    e.preventDefault();
    wantJump();
  }, { passive: false });

  canvas.addEventListener("touchstart", (e) => {
    e.preventDefault();
    wantJump();
  }, { passive: false });

  startBtn.addEventListener("click", async () => {
    await sound.ensure().catch(() => { });
    resetGame();
    doFlap(true);
  });

  restartBtn.addEventListener("click", async () => {
    await sound.ensure().catch(() => { });
    resetGame();
    doFlap(true);
  });

  /* ----------------------------- Pipe Generation ----------------------------- */
  function computeGapSize(score) {
    // Subtle difficulty scaling: gap shrinks slightly, speed increases with score
    const t = clamp(score / 25, 0, 1);
    const gap = lerp(PIPE.gapMax, PIPE.gapMin, easeOutCubic(t));
    return gap;
  }

  function computeSpeed(score) {
    const t = clamp(score / 25, 0, 1);
    return lerp(PIPE.speedBase, PIPE.speedMax, easeOutCubic(t));
  }

  function spawnPipe() {
    const gapSize = computeGapSize(state.score);
    const topLimit = PIPE.marginTop;
    const bottomLimit = H - GROUND.height - PIPE.marginBottom;

    // Convert "gap center" randomization for better spacing
    const centerMin = topLimit + gapSize / 2;
    const centerMax = bottomLimit - gapSize / 2;
    const gapY = centerMin + Math.random() * (centerMax - centerMin);

    state.pipes.push({
      x: W + PIPE.width + 10,
      w: PIPE.width,
      gapY,
      gap: gapSize,
      scored: false,
      // Small visual variation for better look
      hue: 140 + Math.random() * 18
    });
  }

  /* ----------------------------- Physics System ----------------------------- */
  function updatePlaying(dt) {
    state.time += dt;

    // Bird physics
    bird.vy += BIRD.gravity * dt;
    bird.vy = Math.min(bird.vy, BIRD.maxFall);
    bird.y += bird.vy * dt;

    // Ceiling / floor collision (optional classic feel)
    const ceilingY = 20 + bird.r;
    const floorY = H - GROUND.height - bird.r;

    if (bird.y < ceilingY || bird.y > floorY) {
      triggerGameOver("floor");
      return;
    }

    // Squash/stretch recovery
    if (bird.squashTimer > 0) {
      bird.squashTimer = Math.max(0, bird.squashTimer - dt);
      // Smooth back toward 1.0 using an easing shape.
      const t = 1 - (bird.squashTimer / 0.18);
      const e = easeInOutSine(t);
      bird.scaleX = lerp(1.18, 1.0, e);
      bird.scaleY = lerp(0.78, 1.0, e);
    } else {
      // Ensure stability
      bird.scaleX = lerp(bird.scaleX, 1.0, 1 - Math.pow(0.0001, dt));
      bird.scaleY = lerp(bird.scaleY, 1.0, 1 - Math.pow(0.0001, dt));
    }

    // Tilt based on velocity
    const targetTilt = clamp(bird.vy / 500, -0.6, 1.1);
    bird.tilt = lerp(bird.tilt, targetTilt, 1 - Math.pow(0.00001, dt));

    // Trail particles behind bird
    const speedXApprox = computeSpeed(state.score);
    // Spawn based on bird motion; give it a bit of "wake" behind
    const trailVx = -speedXApprox * 0.05;
    particles.spawnTrail(bird.x - 4, bird.y + bird.r * 0.2, trailVx, bird.vy);

    // Pipes
    const speed = computeSpeed(state.score);
    for (const p of state.pipes) {
      p.x -= speed * dt;
    }

    // Spawn new pipes
    state.pipeSpawnTimer -= dt;
    // Slightly randomize spawn cadence for more organic feel
    if (state.pipeSpawnTimer <= 0) {
      spawnPipe();

      // Base with randomness; keep near classic rhythm
      const base = PIPE.spawnEvery;
      const jitter = 0.28 * (Math.random() - 0.5) * 2; // +/- 0.28
      const cadence = clamp(base + jitter, 1.08, 1.78);

      // If score is high, spawn slightly faster
      const t = clamp(state.score / 30, 0, 1);
      state.pipeSpawnTimer = cadence * lerp(1.0, 0.90, t);
    }

    // Remove offscreen pipes
    while (state.pipes.length > 0 && state.pipes[0].x + PIPE.width < -80) {
      state.pipes.shift();
    }

    // Collision & scoring
    const r = bird.r;
    for (const p of state.pipes) {
      const gapTop = p.gapY - p.gap / 2;
      const gapBottom = p.gapY + p.gap / 2;

      // Score when bird passes pipe (center check to avoid multiple triggers)
      if (!p.scored && (p.x + p.w) < bird.x - r * 0.2) {
        p.scored = true;
        state.score += 1;
        sound.score().catch(() => { });
      }

      // Quick x-range test before collision geometry
      if (bird.x + r > p.x && bird.x - r < p.x + p.w) {
        const topRect = { rx: p.x, ry: 0, rw: p.w, rh: gapTop };
        const botRect = { rx: p.x, ry: gapBottom, rw: p.w, rh: H - GROUND.height - gapBottom };

        // Circle vs each rectangle
        if (circleRectCollide(bird.x, bird.y, r * 0.92, topRect.rx, topRect.ry, topRect.rw, topRect.rh) ||
          circleRectCollide(bird.x, bird.y, r * 0.92, botRect.rx, botRect.ry, botRect.rw, botRect.rh)) {
          triggerGameOver("pipe");
          return;
        }
      }
    }
  }

  function updateMenuOverlays() {
    // Live best score in menu
    bestTop.textContent = bestScore;
  }

  function triggerGameOver(reason) {
    if (state.mode !== "playing") return;

    state.mode = "over";
    bird.alive = false;

    // Update best
    if (state.score > bestScore) {
      bestScore = state.score;
      setBest(bestScore);
    }

    // UI updates
    currentTop.textContent = state.score;
    currentPill.textContent = state.score;
    bestPill.textContent = bestScore;

    if (gradeEl) {
      gradeEl.textContent = getGrade(state.score);
      gradeEl.style.animation = "none";
      // Force reflow so animation re-triggers
      void gradeEl.offsetWidth;
      gradeEl.style.animation = "";
    }

    // Pop animation on score pills
    [currentPill, bestPill].forEach(el => {
      el.classList.remove("pop");
      void el.offsetWidth;
      el.classList.add("pop");
    });

    setScreen("over");

    // Sound & effects
    sound.hit().catch(() => { });
    particles.spawnExplosion(bird.x, bird.y);
    particles.spawnMeatChunks(bird.x, bird.y);
    particles.triggerDeathEffects();

    // After explosion, play a more dramatic explosion sound
    setTimeout(() => {
      sound.explosion().catch(() => { });
    }, 30);
  }

  /* ----------------------------- Rendering System ----------------------------- */
  function drawRoundedRect(x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
    ctx.fill();
  }

  function renderBackground() {
    // Sky gradient
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, "#0b2a63");
    grad.addColorStop(0.52, "#071b3f");
    grad.addColorStop(1, "#031022");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // Stars (twinkle with time)
    const t = state.time;
    for (const s of bg.stars) {
      const tw = 0.55 + 0.45 * Math.sin(t * 1.8 + s.tw);
      const a = s.a * tw;
      ctx.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(s.x - bg.offset * BG.stars, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Clouds parallax
    for (const c of bg.clouds) {
      const x = (c.x - bg.offset * c.speedFactor) % (W + c.size);
      const xx = x < -c.size ? x + (W + c.size) : x;

      ctx.save();
      ctx.globalAlpha = c.alpha;
      ctx.fillStyle = "rgba(205,226,255,1)";
      // Cloud blobs
      const y = c.y;
      const s = c.size;
      ctx.beginPath();
      ctx.arc(xx, y, s * 0.26, 0, Math.PI * 2);
      ctx.arc(xx + s * 0.30, y - s * 0.08, s * 0.34, 0, Math.PI * 2);
      ctx.arc(xx + s * 0.62, y, s * 0.28, 0, Math.PI * 2);
      ctx.arc(xx + s * 0.38, y + s * 0.10, s * 0.42, 0, Math.PI * 2);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // Subtle ground haze / depth
    const haze = ctx.createLinearGradient(0, H * 0.62, 0, H);
    haze.addColorStop(0, "rgba(0,0,0,0)");
    haze.addColorStop(1, "rgba(0,0,0,0.35)");
    ctx.fillStyle = haze;
    ctx.fillRect(0, H * 0.62, W, H * 0.38);
  }

  function renderPipes() {
    for (const p of state.pipes) {
      const gapTop = p.gapY - p.gap / 2;
      const gapBottom = p.gapY + p.gap / 2;

      // Pipe body with slight shading
      const hue = p.hue;
      const body = `hsl(${hue} 45% 36%)`;
      const body2 = `hsl(${hue + 10} 55% 28%)`;

      // Top pipe
      ctx.save();
      ctx.fillStyle = body;
      drawRoundedRect(p.x, 0, p.w, gapTop, 14);

      // Bottom pipe
      ctx.fillStyle = body2;
      drawRoundedRect(p.x, gapBottom, p.w, (H - GROUND.height) - gapBottom, 14);

      // Vertical highlight strip
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = "#d4f7ff";
      drawRoundedRect(p.x + p.w * 0.16, 0, Math.max(6, p.w * 0.18), gapTop, 10);
      drawRoundedRect(p.x + p.w * 0.16, gapBottom, Math.max(6, p.w * 0.18), (H - GROUND.height) - gapBottom, 10);

      // Rim
      ctx.globalAlpha = 1;
      ctx.fillStyle = "rgba(255,255,255,0.10)";
      ctx.fillRect(p.x + p.w * 0.08, gapTop - 6, p.w * 0.84, 6);
      ctx.restore();
    }
  }

  function renderGround() {
    const gy = H - GROUND.height;

    // Ground top gradient
    const grad = ctx.createLinearGradient(0, gy, 0, H);
    grad.addColorStop(0, "rgba(40,80,30,0.55)");
    grad.addColorStop(1, "rgba(10,25,12,0.95)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, gy, W, GROUND.height);

    // Ground tiles for visual motion
    const speed = computeSpeed(state.score);
    const tileW = 34;
    const offset = (bg.offset * 1.2) % tileW;

    ctx.save();
    ctx.globalAlpha = 0.95;
    for (let x = -tileW; x < W + tileW; x += tileW) {
      const xx = x - offset;
      ctx.fillStyle = (Math.floor(xx / tileW) % 2 === 0) ? "rgba(55,135,55,0.55)" : "rgba(35,105,35,0.55)";
      ctx.fillRect(xx, gy + 6, tileW - 2, GROUND.height - 10);
      // darker stripes
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = "rgba(0,0,0,0.65)";
      ctx.fillRect(xx, gy + 18, tileW - 2, 6);
      ctx.globalAlpha = 0.95;
    }
    ctx.restore();
  }

  function renderBird() {
    const x = bird.x;
    const y = bird.y;

    // Wing animation (only while alive)
    // Wing animation
    let wingT = 0;
    if (bird.alive) {
      const flapSpeed = 10 + Math.abs(bird.vy) * 0.01;
      bird.wingPhase += (state.mode === "playing" ? flapSpeed : 6) * (1 / 60);
      wingT = Math.sin(bird.wingPhase) * 0.9;
    }

    const sx = bird.scaleX;
    const sy = bird.scaleY;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(bird.tilt * 0.35);
    ctx.scale(sx, sy);

    // Shadow under bird / "meat"
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = "rgba(0,0,0,1)";
    ctx.beginPath();
    ctx.ellipse(0, bird.r * 1.35, bird.r * 1.05, bird.r * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    if (bird.alive) {
      // Alive bird sprite replaced with custom face image
      if (birdImgLoaded) {
        const size = bird.r * 6; // 3x bigger than before
        ctx.save();
        ctx.globalAlpha = 1;
        ctx.drawImage(birdImg, -size / 2, -size / 2, size, size);
        ctx.restore();
      } else {
        // Fallback to simple circle while image is loading
        ctx.fillStyle = "#ffd94a";
        ctx.beginPath();
        ctx.arc(0, 0, bird.r, 0, Math.PI * 2);
        ctx.fill();
      }

      // Keep two visible tear streams regardless of source image details.
      ctx.save();
      ctx.strokeStyle = "rgba(128, 216, 255, 0.92)";
      ctx.fillStyle = "rgba(128, 216, 255, 0.92)";
      ctx.lineWidth = Math.max(1.4, bird.r * 0.1);
      ctx.lineCap = "round";

      ctx.beginPath();
      ctx.moveTo(-bird.r * 0.3, -bird.r * 0.08);
      ctx.quadraticCurveTo(-bird.r * 0.38, bird.r * 0.28, -bird.r * 0.24, bird.r * 0.7);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(-bird.r * 0.24, bird.r * 0.74, bird.r * 0.1, bird.r * 0.15, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(bird.r * 0.02, -bird.r * 0.04);
      ctx.quadraticCurveTo(bird.r * 0.14, bird.r * 0.3, bird.r * 0.2, bird.r * 0.68);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(bird.r * 0.21, bird.r * 0.72, bird.r * 0.095, bird.r * 0.14, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    } else {
      // Dead bird -> bloody meat chunk
      // Main meat blob
      ctx.fillStyle = "#b3121a";
      ctx.beginPath();
      ctx.ellipse(0, 0, bird.r * 1.2, bird.r * 0.8, 0.3, 0, Math.PI * 2);
      ctx.fill();

      // Darker underside
      ctx.fillStyle = "#6a050b";
      ctx.beginPath();
      ctx.ellipse(0, bird.r * 0.15, bird.r, bird.r * 0.5, 0.4, 0, Math.PI * 2);
      ctx.fill();

      // Fat / bone piece sticking out
      ctx.fillStyle = "#f4d5b8";
      ctx.beginPath();
      ctx.ellipse(bird.r * 0.9, -bird.r * 0.1, bird.r * 0.45, bird.r * 0.2, -0.2, 0, Math.PI * 2);
      ctx.fill();

      // Small white bone nub
      ctx.fillStyle = "#f8f8f8";
      ctx.beginPath();
      ctx.arc(bird.r * 1.2, -bird.r * 0.1, bird.r * 0.18, 0, Math.PI * 2);
      ctx.fill();

      // Blood drips
      ctx.fillStyle = "#7b0208";
      ctx.beginPath();
      ctx.ellipse(-bird.r * 0.4, bird.r * 0.6, bird.r * 0.18, bird.r * 0.35, 0, 0, Math.PI * 2);
      ctx.ellipse(bird.r * 0.1, bird.r * 0.7, bird.r * 0.14, bird.r * 0.3, 0.2, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  function renderHUD() {
    // During playing: score on canvas
    if (state.mode !== "playing") return;

    const score = state.score | 0;
    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.font = "900 30px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    // Slight shadow
    ctx.shadowColor = "rgba(0,0,0,0.35)";
    ctx.shadowBlur = 10;
    ctx.fillText(String(score), W / 2, 44);
    ctx.shadowBlur = 0;

    ctx.font = "700 13px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif";
    ctx.fillStyle = "rgba(234,242,255,.86)";
    ctx.textAlign = "left";
    ctx.fillText("BEST " + bestScore + " | " + getGrade(bestScore), 16, 22);

    ctx.restore();
  }

  function render() {
    // Camera shake
    const shakeT = particles.shakeTime;
    let camShakeX = 0, camShakeY = 0;

    if (shakeT > 0 && particles.shakeAmp > 0.1) {
      const frac = shakeT / 0.55; // 1->0
      const amp = particles.shakeAmp * frac;

      // Smooth jitter based on time (avoid pure randomness flicker)
      const t = state.time * 35;
      camShakeX = Math.sin(t * 1.1) * amp;
      camShakeY = Math.cos(t * 1.3) * amp * 0.7;
    }

    // Background and scene
    ctx.save();
    ctx.translate(camShakeX, camShakeY);

    // Parallax offset: use how much world "moved" by pipe speed
    // This is updated in update loop with bg.offset in world units.
    renderBackground();
    // Pipes, bird, particles
    renderPipes();
    renderGround();
    renderBird();

    // Particles are rendered after bird so explosion pops nicely.
    particles.render(ctx, camShakeX, camShakeY);

    // Foreground HUD text (draw with translation applied)
    renderHUD();

    ctx.restore();
  }

  /* ----------------------------- Game Loop ----------------------------- */
  function tick(ms) {
    const t = ms;
    let dt = (t - (state.lastFrameMs || t)) / 1000;
    dt = clamp(dt, 0, 0.034); // prevent huge jumps

    // If not playing, still render for nice ambient feel.
    // But slow motion/time scale should only affect gameplay during explosion over.
    if (state.mode === "playing") {
      const timeScale = particles.getTimeScale();
      const effDt = dt * timeScale;

      // Update world time and background offset even during slow-mo
      state.time += effDt; // time for motion/animations
      bg.offset += (computeSpeed(state.score) * effDt) / 200; // normalized distance

      updatePlaying(effDt);

      particles.update(effDt);
    } else {
      // Keep subtle parallax motion in menu/over
      // No physics; just animate background stars/clouds.
      state.time += dt;
      bg.offset += (computeSpeed(state.score) * dt) / 220;
      particles.update(dt * 0.5); // allow explosion particles to fade after death
    }

    render();
    state.lastFrameMs = t;
    requestAnimationFrame(tick);
  }

  /* ----------------------------- Start Up ----------------------------- */
  ensureCanvasSize();

  function initMenu() {
    state.mode = "menu";
    state.score = 0;
    // Keep bird at a pleasing spot in menu
    bird.x = Math.floor(W * BIRD.xRatio);
    bird.y = Math.floor(H * 0.46);
    bird.vy = 0;
    bird.tilt = 0;
    bird.scaleX = 1;
    bird.scaleY = 1;
    bird.squashTimer = 0;
    state.pipes = [];
    particles.trails.length = 0;
    particles.explosions.length = 0;

    setScreen("menu");
    updateMenuOverlays();
  }

  initMenu();
  requestAnimationFrame(tick);

  // Extra: click canvas in menu to encourage immediate play
  canvas.addEventListener("mouseup", () => updateMenuOverlays());

})();
