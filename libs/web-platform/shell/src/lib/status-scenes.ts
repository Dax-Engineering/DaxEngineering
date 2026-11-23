export type StatusScene = 'error' | 'not-found';
export type StatusTheme = 'light' | 'dark';

type Palette = {
  blob: string;
  floor: string;
  floorOpacity: number;
  ink: string;
  inkSoft: string;
  accent: string;
  glyph: string;
};

const PALETTES: Record<StatusTheme, Palette> = {
  light: {
    blob: '#e6eaf6',
    floor: '#162568',
    floorOpacity: 10,
    ink: '#162568',
    inkSoft: '#b3bcdf',
    accent: '#ee7a12',
    glyph: '#ffffff',
  },
  dark: {
    blob: '#1a2230',
    floor: '#000000',
    floorOpacity: 35,
    ink: '#8c9fe6',
    inkSoft: '#34405c',
    accent: '#f0912f',
    glyph: '#0f1418',
  },
};

const W = 400;
const H = 300;
const END = 180;

type Pt = [number, number];
type Value = number | number[];

const rgba = (hex: string): number[] => {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1];
};
const fixed = (k: unknown) => ({ a: 0, k });
const keys = (frames: Array<[number, Value]>) => ({
  a: 1,
  k: frames.map(([t, v], i) => ({
    t,
    s: Array.isArray(v) ? v : [v],
    ...(i < frames.length - 1
      ? { i: { x: 0.45, y: 1 }, o: { x: 0.55, y: 0 } }
      : {}),
  })),
});

const transform = () => ({
  ty: 'tr',
  p: fixed([0, 0]),
  a: fixed([0, 0]),
  s: fixed([100, 100]),
  r: fixed(0),
  o: fixed(100),
  sk: fixed(0),
  sa: fixed(0),
});
const group = (...items: object[]) => ({
  ty: 'gr',
  it: [...items, transform()],
});
const fill = (hex: string, opacity = 100, evenOdd = false) => ({
  ty: 'fl',
  c: fixed(rgba(hex)),
  o: fixed(opacity),
  r: evenOdd ? 2 : 1,
});
const stroke = (hex: string, width: number, opacity = 100, dash?: Pt) => ({
  ty: 'st',
  c: fixed(rgba(hex)),
  o: fixed(opacity),
  w: fixed(width),
  lc: 2,
  lj: 2,
  ml: 4,
  ...(dash
    ? {
        d: [
          { n: 'd', nm: 'dash', v: fixed(dash[0]) },
          { n: 'g', nm: 'gap', v: fixed(dash[1]) },
        ],
      }
    : {}),
});
const ellipse = (x: number, y: number, w: number, h = w) => ({
  ty: 'el',
  d: 1,
  p: fixed([x, y]),
  s: fixed([w, h]),
});
const rect = (x: number, y: number, w: number, h: number, r = 0) => ({
  ty: 'rc',
  d: 1,
  p: fixed([x, y]),
  s: fixed([w, h]),
  r: fixed(r),
});
const path = (v: Pt[], closed: boolean, inT?: Pt[], outT?: Pt[]) => ({
  ty: 'sh',
  d: 1,
  ks: fixed({
    c: closed,
    v,
    i: inT ?? v.map(() => [0, 0]),
    o: outT ?? v.map(() => [0, 0]),
  }),
});

type LayerMotion = {
  p?: object;
  r?: object;
  s?: object;
  o?: object;
  a?: Value;
};
const layer = (name: string, shapes: object[], m: LayerMotion = {}) => ({
  ddd: 0,
  ty: 4,
  nm: name,
  sr: 1,
  ao: 0,
  bm: 0,
  ip: 0,
  op: END,
  st: 0,
  ks: {
    o: m.o ?? fixed(100),
    r: m.r ?? fixed(0),
    p: m.p ?? fixed([0, 0, 0]),
    a: fixed(m.a ?? [0, 0, 0]),
    s: m.s ?? fixed([100, 100, 100]),
  },
  shapes,
});
const at = (x: number, y: number) => fixed([x, y, 0]);

function gear(teeth: number, outer: number, root: number): object {
  const step = (2 * Math.PI) / teeth;
  const v: Pt[] = [];
  for (let k = 0; k < teeth; k++) {
    const a = k * step;
    const profile: Array<[number, number]> = [
      [a - step * 0.3, root],
      [a - step * 0.16, outer],
      [a + step * 0.16, outer],
      [a + step * 0.3, root],
    ];
    for (const [ang, r] of profile) {
      v.push([
        Math.round(r * Math.sin(ang) * 100) / 100,
        Math.round(-r * Math.cos(ang) * 100) / 100,
      ]);
    }
  }
  return path(v, true);
}

function backdrop(c: Palette): object[] {
  return [
    layer('blob', [group(ellipse(0, 0, 310, 200), fill(c.blob))], {
      p: at(200, 158),
      s: keys([
        [0, [100, 100, 100]],
        [90, [104, 103, 100]],
        [END, [100, 100, 100]],
      ]),
    }),
    layer(
      'floor',
      [group(ellipse(0, 0, 260, 14), fill(c.floor, c.floorOpacity))],
      {
        p: at(200, 262),
      },
    ),
  ];
}

/** Two gears that keep jamming, with a wobbling warning sign. */
function errorLayers(c: Palette): object[] {
  const big: Array<[number, number]> = [
    [0, 0],
    [55, 34],
    [63, 28],
    [75, 36],
    [130, 70],
    [138, 64],
    [150, 72],
    [END, 72],
  ];
  const wobble: Array<[number, Value]> = [
    [0, 0],
    [56, 0],
    [61, -7],
    [67, 5],
    [73, -2],
    [80, 0],
    [131, 0],
    [136, -7],
    [142, 5],
    [148, -2],
    [155, 0],
    [END, 0],
  ];
  const meshAngle = Math.atan2(-0.82, -0.57);
  const sparks = [-0.6, 0, 0.6].map((d) => {
    const a = meshAngle + d;
    return path(
      [
        [Math.cos(a) * 12, Math.sin(a) * 12],
        [Math.cos(a) * 24, Math.sin(a) * 24],
      ],
      false,
    );
  });
  const flash: Array<[number, Value]> = [
    [0, 0],
    [54, 0],
    [57, 100],
    [70, 0],
    [129, 0],
    [132, 100],
    [145, 0],
    [END, 0],
  ];
  return [
    ...backdrop(c),
    layer(
      'big gear',
      [
        group(
          gear(10, 66, 54),
          ellipse(0, 0, 44),
          fill(c.ink, 100, true),
          stroke(c.ink, 4),
        ),
      ],
      { p: at(168, 150), r: keys(big) },
    ),
    layer(
      'small gear',
      [
        group(
          gear(8, 36, 27),
          ellipse(0, 0, 20),
          fill(c.accent, 100, true),
          stroke(c.accent, 3),
        ),
      ],
      { p: at(243, 98), r: keys(big.map(([t, r]) => [t, r * -1.25])) },
    ),
    layer('sparks', [group(...sparks, stroke(c.accent, 4))], {
      p: at(207, 126),
      o: keys(flash),
    }),
    layer(
      'warning',
      [
        group(rect(0, -4, 7, 24, 3.5), ellipse(0, 17, 8), fill(c.glyph)),
        group(
          path(
            [
              [0, -36],
              [38, 30],
              [-38, 30],
            ],
            true,
          ),
          fill(c.accent),
          stroke(c.accent, 14),
        ),
      ],
      { p: at(300, 248), a: [0, 37, 0], r: keys(wobble) },
    ),
  ];
}

/** A magnifier searching a shelf with an empty, dashed slot. */
function notFoundLayers(c: Palette): object[] {
  const question = path(
    [
      [-11, -8],
      [0, -20],
      [11, -8],
      [0, 4],
      [0, 9],
    ],
    false,
    [
      [0, 0],
      [-7, 0],
      [0, -7],
      [5, -4],
      [0, 0],
    ],
    [
      [0, -7],
      [7, 0],
      [0, 6],
      [0, 0],
      [0, 0],
    ],
  );
  return [
    ...backdrop(c),
    layer(
      'shelf',
      [
        group(
          rect(-96, 0, 10, 170, 4),
          rect(96, 0, 10, 170, 4),
          rect(0, -80, 210, 9, 4),
          rect(0, -10, 210, 9, 4),
          rect(0, 62, 210, 9, 4),
          fill(c.inkSoft),
        ),
      ],
      { p: at(200, 175) },
    ),
    layer(
      'boxes',
      [
        group(
          rect(-46, 38, 46, 38, 5),
          rect(2, 42, 36, 30, 5),
          fill(c.ink, 85),
        ),
        group(
          rect(-46, 30, 16, 4, 2),
          rect(2, 36, 12, 4, 2),
          fill(c.glyph, 70),
        ),
        group(rect(56, -29, 32, 28, 5), fill(c.ink, 85)),
        group(rect(56, -37, 12, 4, 2), fill(c.glyph, 70)),
        group(rect(-40, -34, 54, 40, 6), stroke(c.accent, 3, 100, [7, 6])),
      ],
      { p: at(200, 175) },
    ),
    layer(
      'question',
      [
        group(question, stroke(c.accent, 7)),
        group(ellipse(0, 20, 8), fill(c.accent)),
      ],
      {
        p: at(300, 62),
        s: keys([
          [0, [0, 0, 100]],
          [20, [0, 0, 100]],
          [32, [115, 115, 100]],
          [40, [100, 100, 100]],
          [150, [100, 100, 100]],
          [165, [0, 0, 100]],
          [END, [0, 0, 100]],
        ]),
        r: keys([
          [0, 0],
          [60, -8],
          [100, 8],
          [140, 0],
          [END, 0],
        ]),
      },
    ),
    layer(
      'magnifier',
      [
        group(
          path(
            [
              [-15, -6],
              [-6, -15],
            ],
            false,
          ),
          stroke(c.glyph, 4, 80),
        ),
        group(ellipse(0, 0, 62), fill(c.glyph, 45), stroke(c.ink, 9)),
        group(
          path(
            [
              [24, 24],
              [44, 44],
            ],
            false,
          ),
          stroke(c.ink, 13),
        ),
      ],
      {
        p: keys([
          [0, [160, 138, 0]],
          [45, [245, 118, 0]],
          [90, [268, 190, 0]],
          [135, [170, 198, 0]],
          [END, [160, 138, 0]],
        ]),
        r: keys([
          [0, -8],
          [45, 4],
          [90, 10],
          [135, -4],
          [END, -8],
        ]),
      },
    ),
  ];
}

/** A Lottie animation in DAX colours, plus the frame shown when motion is reduced. */
export function statusScene(scene: StatusScene, theme: StatusTheme) {
  const c = PALETTES[theme];
  const bottomUp = scene === 'error' ? errorLayers(c) : notFoundLayers(c);
  const layers = bottomUp.reverse().map((l, i) => ({ ...l, ind: i + 1 }));
  return {
    still: scene === 'error' ? 40 : 45,
    data: {
      v: '5.7.4',
      fr: 60,
      ip: 0,
      op: END,
      w: W,
      h: H,
      nm: scene,
      ddd: 0,
      assets: [],
      layers,
    },
  };
}
