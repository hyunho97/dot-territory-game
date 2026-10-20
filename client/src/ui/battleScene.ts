/**
 * 전투 연출 (표시 전용 — 결과는 서버가 이미 확정했고 여기서는 그 결과를 "보여 주기만" 한다).
 * 양쪽 병력을 최대 몇 명의 전투원으로 줄여 개별 스프라이트로 그리고,
 * 접근 → 교전(근접 돌진/원거리 투사체, 타격 이펙트, 피해 숫자, 쓰러짐) → 승패 연출 순서로 재생한다.
 */

export interface SceneArmy {
  unitId: string;
  count: number;
}
export interface SceneInput {
  armyA: SceneArmy[];
  armyB: SceneArmy[];
  aLosses: SceneArmy[];
  bLosses: SceneArmy[];
  winner: 'A' | 'B' | 'draw';
  aCP: number;
  bCP: number;
}
export interface SceneOpts {
  images: Map<string, HTMLImageElement | null>;
  /** 유닛 병종 (melee/ranged/magic …) */
  classOf: (unitId: string) => string | undefined;
  nameOf: (unitId: string) => string;
  bg?: HTMLImageElement | null;
  arrow?: HTMLImageElement | null;
  magic?: HTMLImageElement | null;
  labels: { me: string; enemy: string; win: string; lose: string; draw: string };
}

interface Fighter {
  side: 'A' | 'B';
  unitId: string;
  ranged: 'arrow' | 'magic' | null;
  hx: number; // 대기(진형) 위치
  hy: number;
  phase: number;
  period: number;
  dies: boolean;
  dieAt: number;
  lastHit: number;
  lastShot: number;
}
interface Spark {
  x: number;
  y: number;
  born: number;
  big: boolean;
}
interface Floater {
  x: number;
  y: number;
  born: number;
  text: string;
  color: string;
}
interface Shot {
  from: Fighter;
  to: Fighter;
  born: number;
  dur: number;
  kind: 'arrow' | 'magic';
}

const MAX_FIGHTERS = 18;
const T_MARCH = 900;
const T_FIGHT_END = 3700;
const T_FINISH = 4900;

const ease = (v: number): number => 1 - (1 - v) * (1 - v);
const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/** 병력 수를 전투원 수로 줄이면서 병종 비율을 유지한다 */
function buildFighters(
  side: 'A' | 'B',
  army: SceneArmy[],
  losses: SceneArmy[],
  opts: SceneOpts,
  W: number,
  H: number,
): Fighter[] {
  const total = army.reduce((s, u) => s + u.count, 0);
  if (total <= 0) return [];
  const budget = Math.min(total, MAX_FIGHTERS);
  const groups = army.map((u) => ({
    ...u,
    n: Math.max(1, Math.round((u.count / total) * budget)),
  }));
  // 반올림으로 늘어난 전투원 수는 가장 큰 그룹에서 줄인다
  let sum = groups.reduce((s, g) => s + g.n, 0);
  while (sum > MAX_FIGHTERS) {
    const big = groups.reduce((a, b) => (b.n > a.n ? b : a));
    if (big.n <= 1) break;
    big.n--;
    sum--;
  }
  const list: Fighter[] = [];
  const rows = Math.min(5, Math.max(2, Math.ceil(sum / 3)));
  const cols = Math.ceil(sum / rows);
  const top = 78;
  const bottom = H - 36;
  const rowGap = (bottom - top) / rows;
  let idx = 0;
  const frontX = side === 'A' ? W / 2 - 70 : W / 2 + 70;
  for (const g of groups) {
    const lost = losses.find((l) => l.unitId === g.unitId)?.count ?? 0;
    const deadN = lost >= g.count ? g.n : Math.round((lost / g.count) * g.n);
    const cls = opts.classOf(g.unitId);
    const ranged = cls === 'magic' ? 'magic' : cls === 'ranged' ? 'arrow' : null;
    for (let i = 0; i < g.n; i++) {
      const col = Math.floor(idx / rows);
      const row = idx % rows;
      const stagger = col % 2 === 1 ? rowGap * 0.3 : 0;
      const dx = col * 44 + (ranged ? 36 : 0); // 원거리는 뒤쪽에 선다
      list.push({
        side,
        unitId: g.unitId,
        ranged,
        hx: side === 'A' ? frontX - dx : frontX + dx,
        hy: top + rowGap * (row + 0.5) + stagger,
        phase: Math.random() * 1000,
        period: 520 + Math.random() * 260,
        dies: i < deadN,
        dieAt: T_MARCH + 500 + Math.random() * (T_FIGHT_END - T_MARCH - 900),
        lastHit: -1e9,
        lastShot: 0,
      });
      idx++;
    }
  }
  void cols;
  return list;
}

export function playBattle(
  canvas: HTMLCanvasElement,
  input: SceneInput,
  opts: SceneOpts,
  onDone: () => void,
): { skip: () => void; stop: () => void } {
  const W = canvas.width;
  const H = canvas.height;
  const g = canvas.getContext('2d')!;
  g.imageSmoothingEnabled = false;

  const A = buildFighters('A', input.armyA, input.aLosses, opts, W, H);
  const B = buildFighters('B', input.armyB, input.bLosses, opts, W, H);
  const all = [...A, ...B];
  const sizeFor = (n: number): number => (n > 12 ? 44 : n > 6 ? 52 : 60);
  const SIZE_A = sizeFor(A.length);
  const SIZE_B = sizeFor(B.length);
  const sparks: Spark[] = [];
  const floaters: Floater[] = [];
  const shots: Shot[] = [];
  const perHitA = Math.max(1, Math.round(input.aCP / Math.max(1, A.length)));
  const perHitB = Math.max(1, Math.round(input.bCP / Math.max(1, B.length)));

  let raf = 0;
  let stopped = false;
  let finished = false;
  const start = performance.now();

  const alive = (f: Fighter, e: number): boolean => !f.dies || e < f.dieAt;
  const pickTarget = (from: Fighter, e: number): Fighter | null => {
    const foes = (from.side === 'A' ? B : A).filter((f) => alive(f, e));
    return foes.length ? foes[Math.floor(Math.random() * foes.length)] : null;
  };
  const pos = (f: Fighter, e: number): { x: number; y: number } => {
    const march = ease(clamp01(e / T_MARCH));
    const fromX = f.side === 'A' ? -80 : W + 80;
    let x = fromX + (f.hx - fromX) * march;
    let y = f.hy;
    if (e > T_MARCH && e < T_FIGHT_END && alive(f, e)) {
      const wave = Math.sin(((e + f.phase) / f.period) * Math.PI * 2);
      if (f.ranged) {
        y += Math.sin((e + f.phase) / 300) * 2;
      } else {
        // 근접: 상대 쪽으로 돌진했다가 물러난다
        const lunge = Math.max(0, wave) * 30;
        x += (f.side === 'A' ? 1 : -1) * (lunge + 18);
      }
      // 타격 순간 짧게 밀려난다
      const since = e - f.lastHit;
      if (since < 140) x += (f.side === 'A' ? -1 : 1) * (1 - since / 140) * 10;
    } else if (e <= T_MARCH) {
      y += Math.sin(e / 70 + f.phase) * 2; // 행군 중 위아래 흔들림
    }
    return { x, y };
  };

  const drawFighter = (f: Fighter, e: number, winnerSide: 'A' | 'B' | 'draw'): void => {
    const size = f.side === 'A' ? SIZE_A : SIZE_B;
    const p = pos(f, e);
    let alpha = 1;
    let fall = 0;
    let rot = 0;
    let jump = 0;
    if (f.dies && e >= f.dieAt) {
      const k = clamp01((e - f.dieAt) / 450);
      alpha = 1 - k;
      fall = k * 18;
      rot = (f.side === 'A' ? -1 : 1) * k * 1.4;
      if (alpha <= 0) return;
    } else if (e > T_FIGHT_END && winnerSide === f.side) {
      jump = Math.abs(Math.sin((e - T_FIGHT_END) / 160 + f.phase)) * 14;
    }
    const img = opts.images.get(f.unitId);
    // 그림자
    g.save();
    g.globalAlpha = alpha * 0.35;
    g.fillStyle = '#000';
    g.beginPath();
    g.ellipse(p.x, p.y + size * 0.42, size * 0.32, size * 0.1, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
    g.save();
    g.globalAlpha = alpha;
    g.translate(p.x, p.y + fall - jump);
    if (rot) g.rotate(rot);
    if (f.side === 'B') g.scale(-1, 1);
    const flash = e - f.lastHit < 90;
    if (img) {
      g.drawImage(img, -size / 2, -size / 2, size, size);
      if (flash) {
        g.globalCompositeOperation = 'lighter';
        g.globalAlpha = alpha * 0.6;
        g.drawImage(img, -size / 2, -size / 2, size, size);
      }
    } else {
      g.fillStyle = f.side === 'A' ? '#3f6fb5' : '#a33a3a';
      g.fillRect(-size / 3, -size / 2.5, (size * 2) / 3, size * 0.8);
      g.strokeStyle = '#000';
      g.lineWidth = 3;
      g.strokeRect(-size / 3, -size / 2.5, (size * 2) / 3, size * 0.8);
    }
    g.restore();
  };

  const text = (
    s: string,
    x: number,
    y: number,
    size: number,
    color: string,
    align: CanvasTextAlign = 'center',
  ): void => {
    g.save();
    g.font = `${size}px DotGothic16, monospace`;
    g.textAlign = align;
    g.lineWidth = Math.max(3, size / 5);
    g.strokeStyle = '#000';
    g.fillStyle = color;
    g.strokeText(s, x, y);
    g.fillText(s, x, y);
    g.restore();
  };

  const hpBar = (side: 'A' | 'B', e: number): void => {
    const list = side === 'A' ? A : B;
    const aliveN = list.filter((f) => alive(f, e)).length;
    const k = list.length ? aliveN / list.length : 0;
    const bw = W / 2 - 40;
    const x = side === 'A' ? 16 : W - 16 - bw;
    g.fillStyle = '#000';
    g.fillRect(x - 3, 12, bw + 6, 20);
    g.fillStyle = '#2a2a2a';
    g.fillRect(x, 15, bw, 14);
    g.fillStyle = side === 'A' ? '#4a8fe0' : '#d04a4a';
    const w = bw * k;
    g.fillRect(side === 'A' ? x : x + bw - w, 15, w, 14);
    text(
      side === 'A' ? opts.labels.me : opts.labels.enemy,
      side === 'A' ? x + 4 : x + bw - 4,
      46,
      13,
      '#fff',
      side === 'A' ? 'left' : 'right',
    );
  };

  const drawBg = (e: number): void => {
    if (opts.bg && opts.bg.complete && opts.bg.naturalWidth > 0) {
      // 가로 기준으로 맞추고 세로는 가운데를 잘라 쓴다 (비율 유지)
      const sw = opts.bg.naturalWidth;
      const sh = Math.min(opts.bg.naturalHeight, (sw * H) / W);
      g.drawImage(opts.bg, 0, (opts.bg.naturalHeight - sh) / 2, sw, sh, 0, 0, W, H);
    } else {
      g.fillStyle = '#243a22';
      g.fillRect(0, 0, W, H);
    }
    g.fillStyle = 'rgba(10,12,20,0.35)';
    g.fillRect(0, 0, W, H);
    // 비네트
    const grad = g.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, W * 0.7);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.55)');
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
    // 교전 중 먼지 줄무늬
    if (e > T_MARCH && e < T_FIGHT_END) {
      g.fillStyle = 'rgba(220,200,160,0.07)';
      for (let i = 0; i < 4; i++) {
        const dx = ((e / 6 + i * 190) % (W + 160)) - 80;
        g.fillRect(dx, H - 40 - i * 12, 120, 3);
      }
    }
  };

  const finish = (): void => {
    if (finished || stopped) return;
    finished = true;
    cancelAnimationFrame(raf);
    onDone();
  };

  const frame = (ts: number): void => {
    if (stopped || finished) return;
    const e = ts - start;
    // 교전 이벤트 생성
    if (e > T_MARCH && e < T_FIGHT_END) {
      for (const f of all) {
        if (!alive(f, e)) continue;
        const wave = Math.sin(((e + f.phase) / f.period) * Math.PI * 2);
        const hitWindow = e - f.lastShot > f.period * 0.9;
        if (f.ranged) {
          if (hitWindow && wave > 0.95) {
            const to = pickTarget(f, e);
            const img = f.ranged === 'magic' ? opts.magic : opts.arrow;
            if (to && (img || true)) {
              shots.push({ from: f, to, born: e, dur: 320 + Math.random() * 120, kind: f.ranged });
              f.lastShot = e;
            }
          }
        } else if (hitWindow && wave > 0.97) {
          const to = pickTarget(f, e);
          if (to) {
            f.lastShot = e;
            to.lastHit = e;
            const tp = pos(to, e);
            sparks.push({ x: tp.x, y: tp.y - 6, born: e, big: Math.random() < 0.2 });
            const dmg = Math.round(
              (f.side === 'A' ? perHitA : perHitB) * (0.6 + Math.random() * 0.8),
            );
            floaters.push({
              x: tp.x + (Math.random() * 16 - 8),
              y: tp.y - 22,
              born: e,
              text: String(dmg),
              color: f.side === 'A' ? '#ffe27a' : '#ff8a80',
            });
          }
        }
      }
    }
    // 투사체 도착 처리
    for (let i = shots.length - 1; i >= 0; i--) {
      const s = shots[i];
      if (e - s.born >= s.dur) {
        s.to.lastHit = e;
        const tp = pos(s.to, e);
        sparks.push({ x: tp.x, y: tp.y - 6, born: e, big: s.kind === 'magic' });
        const dmg = Math.round(
          (s.from.side === 'A' ? perHitA : perHitB) * (0.6 + Math.random() * 0.8),
        );
        floaters.push({
          x: tp.x,
          y: tp.y - 22,
          born: e,
          text: String(dmg),
          color: s.from.side === 'A' ? '#ffe27a' : '#ff8a80',
        });
        shots.splice(i, 1);
      }
    }

    drawBg(e);
    // 깊이 순서 (y 가 큰 쪽이 앞)
    const winnerSide = input.winner;
    const order = [...all].sort((a, b) => pos(a, e).y - pos(b, e).y);
    for (const f of order) drawFighter(f, e, winnerSide);

    // 투사체
    for (const s of shots) {
      const k = clamp01((e - s.born) / s.dur);
      const a = pos(s.from, e);
      const b = pos(s.to, e);
      const x = a.x + (b.x - a.x) * k;
      const y = a.y + (b.y - a.y) * k - Math.sin(k * Math.PI) * 26;
      const img = s.kind === 'magic' ? opts.magic : opts.arrow;
      g.save();
      g.translate(x, y);
      if (s.from.side === 'B') g.scale(-1, 1);
      if (img && img.complete && img.naturalWidth > 0) g.drawImage(img, -14, -14, 28, 28);
      else {
        g.fillStyle = s.kind === 'magic' ? '#9ad7ff' : '#f3e3a0';
        g.fillRect(-5, -2, 10, 4);
      }
      g.restore();
    }
    // 타격 이펙트
    for (let i = sparks.length - 1; i >= 0; i--) {
      const sp = sparks[i];
      const k = (e - sp.born) / 260;
      if (k >= 1) {
        sparks.splice(i, 1);
        continue;
      }
      g.save();
      g.strokeStyle = `rgba(255,${sp.big ? 160 : 230},120,${1 - k})`;
      g.lineWidth = sp.big ? 4 : 3;
      const n = sp.big ? 10 : 6;
      for (let j = 0; j < n; j++) {
        const ang = (j / n) * Math.PI * 2 + sp.born;
        const r1 = 4 + k * (sp.big ? 18 : 12);
        const r2 = r1 + (sp.big ? 10 : 6);
        g.beginPath();
        g.moveTo(sp.x + Math.cos(ang) * r1, sp.y + Math.sin(ang) * r1);
        g.lineTo(sp.x + Math.cos(ang) * r2, sp.y + Math.sin(ang) * r2);
        g.stroke();
      }
      g.restore();
    }
    // 피해 숫자
    for (let i = floaters.length - 1; i >= 0; i--) {
      const fl = floaters[i];
      const k = (e - fl.born) / 700;
      if (k >= 1) {
        floaters.splice(i, 1);
        continue;
      }
      g.save();
      g.globalAlpha = 1 - k * k;
      text(fl.text, fl.x, fl.y - k * 26, 15, fl.color);
      g.restore();
    }

    hpBar('A', e);
    hpBar('B', e);

    // 승패 배너
    if (e > T_FIGHT_END) {
      const k = clamp01((e - T_FIGHT_END) / 350);
      const label =
        input.winner === 'A'
          ? opts.labels.win
          : input.winner === 'B'
            ? opts.labels.lose
            : opts.labels.draw;
      const color = input.winner === 'A' ? '#ffd54f' : input.winner === 'B' ? '#ff6b6b' : '#e0e0e0';
      g.save();
      g.fillStyle = `rgba(255,255,255,${0.35 * (1 - k)})`; // 섬광
      g.fillRect(0, 0, W, H);
      g.fillStyle = `rgba(0,0,0,${0.45 * k})`;
      g.fillRect(0, H / 2 - 44, W, 88);
      g.restore();
      g.save();
      g.translate(W / 2, H / 2 + 14 - (1 - ease(k)) * 40);
      g.scale(0.6 + 0.4 * ease(k), 0.6 + 0.4 * ease(k));
      text(label, 0, 0, 56, color);
      g.restore();
    }
    if (e >= T_FINISH) return finish();
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  return {
    skip: finish,
    stop: () => {
      stopped = true;
      cancelAnimationFrame(raf);
    },
  };
}
