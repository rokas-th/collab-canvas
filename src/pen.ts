import { getStroke } from 'perfect-freehand';

export const PEN_WIDTH = 4;
export const MIN_PEN_PX = 3;
const THINNING = 0.5;
const SMOOTHING = 0.5;
const STREAMLINE = 0.4;
const TAPER_START = 4;
const TAPER_END = 6;
const TAPER_SHARE_START = 0.25;
const TAPER_SHARE_END = 0.35;
const EVEN_PRESSURE = 0.5;

/** Nominal pen diameter in board units: PEN_WIDTH, never below `minPx` on screen. */
export function penSize(onScreen: number, minPx: number): number {
  return Math.ceil(Math.max(PEN_WIDTH, minPx / onScreen) * 4) / 4;
}

const mid = (a: number, b: number) => ((a + b) / 2).toFixed(2);

/** SVG path of the pen outline; `floor` is the thinnest allowed body diameter in board units. */
export function penOutline(points: number[], pressure: number[] | undefined, size: number, floor: number): string {
  if (points.length < 2 || points.length % 2 !== 0)
    throw new Error(`A stroke needs x,y pairs, got ${points.length} coordinates`);
  if (pressure && pressure.length * 2 !== points.length)
    throw new Error(`A stroke has ${points.length / 2} points but ${pressure.length} pressure values`);
  const input = Array.from({ length: points.length / 2 }, (_, i) => [
    points[i * 2],
    points[i * 2 + 1],
    pressure ? pressure[i] : EVEN_PRESSURE,
  ]);
  const length = input.slice(1).reduce((sum, p, i) => sum + Math.hypot(p[0] - input[i][0], p[1] - input[i][1]), 0);
  const tapered = length >= size * TAPER_START;
  const minRadius = floor / 2 / size;
  const o = getStroke(length < size ? [input[0], input[0]] : input, {
    size,
    thinning: THINNING,
    smoothing: SMOOTHING,
    streamline: STREAMLINE,
    simulatePressure: false,
    easing: (r) => Math.max(r, minRadius),
    start: { taper: tapered ? Math.min(size * TAPER_START, length * TAPER_SHARE_START) : 0, cap: true },
    end: { taper: tapered ? Math.min(size * TAPER_END, length * TAPER_SHARE_END) : 0, cap: true },
    last: true,
  });
  if (o.length < 4)
    throw new Error(`perfect-freehand returned ${o.length} outline points for a ${input.length}-point stroke`);
  const head = `M${o[0][0].toFixed(2)},${o[0][1].toFixed(2)} Q${o[1][0].toFixed(2)},${o[1][1].toFixed(2)} ${mid(o[1][0], o[2][0])},${mid(o[1][1], o[2][1])} T`;
  const body = o
    .slice(2, -1)
    .map((p, i) => `${mid(p[0], o[i + 3][0])},${mid(p[1], o[i + 3][1])}`)
    .join(' ');
  return `${head}${body}Z`;
}
