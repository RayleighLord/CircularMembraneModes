import type {
  AzimuthalModeIndex,
  CartesianGradient,
  ModeSelection,
  NodalPattern,
  PolarGradient,
  RadialModeIndex,
  WaveParameters
} from "../types";
import { AZIMUTHAL_MODE_INDICES, RADIAL_MODE_INDICES } from "../types";

export const MIN_AZIMUTHAL_MODE_INDEX: AzimuthalModeIndex = 0;
export const MAX_AZIMUTHAL_MODE_INDEX: AzimuthalModeIndex = 8;
export const MIN_RADIAL_MODE_INDEX: RadialModeIndex = 1;
export const MAX_RADIAL_MODE_INDEX: RadialModeIndex = 8;

export const DEFAULT_MODE: Readonly<ModeSelection> = Object.freeze({ m: 2, n: 3 });

export const DEFAULT_WAVE_PARAMETERS: Readonly<WaveParameters> = Object.freeze({
  amplitude: 1,
  phase: 0
});

/** Illustrative browser-animation period assigned to the fundamental (0,1) mode. */
export const FUNDAMENTAL_CYCLE_SECONDS = 10;

/**
 * Positive zeros j_(m,n) of J_m, indexed first by m=0,...,8 and then n=1,...,8.
 * Values are embedded so interaction never performs a root search.
 */
export const BESSEL_ZEROS: readonly (readonly number[])[] = Object.freeze([
  Object.freeze([
    2.404825557695772, 5.520078110286311, 8.653727912911013, 11.79153443901428,
    14.93091770848779, 18.07106396791092, 21.21163662987926, 24.3524715307493
  ]),
  Object.freeze([
    3.831705970207512, 7.015586669815619, 10.17346813506272, 13.32369193631422,
    16.47063005087763, 19.61585851046824, 22.76008438059277, 25.90367208761838
  ]),
  Object.freeze([
    5.135622301840683, 8.417244140399866, 11.61984117214906, 14.79595178235126,
    17.95981949498783, 21.11699705302184, 24.2701123135731, 27.42057354998456
  ]),
  Object.freeze([
    6.380161895923984, 9.76102312998167, 13.01520072169843, 16.22346616031877,
    19.40941522643501, 22.58272959310444, 25.74816669929498, 28.90835078092176
  ]),
  Object.freeze([
    7.588342434503804, 11.06470948850118, 14.37253667161759, 17.61596604980483,
    20.82693295696239, 24.01901952477111, 27.19908776598125, 30.37100766711725
  ]),
  Object.freeze([
    8.771483815959954, 12.33860419746694, 15.70017407971167, 18.98013387517992,
    22.21779989656127, 25.4303411542227, 28.62661830729114, 31.81171672404776
  ]),
  Object.freeze([
    9.936109524217686, 13.58929017054122, 17.00381966781601, 20.32078921356651,
    23.58608443558139, 26.8201519834114, 30.03372238657047, 33.23304176284712
  ]),
  Object.freeze([
    11.08637001924508, 14.82126872701317, 18.28758283248173, 21.6415410198484,
    24.93492788767302, 28.1911884594832, 31.42279419226558, 34.63708935206932
  ]),
  Object.freeze([
    12.22509226400466, 16.03777419088771, 19.55453643099705, 22.94517313187462,
    26.26681464117664, 29.54565967099855, 32.79580003734146, 36.02561506386957
  ])
]);

/** max_(rho in [0,1]) |J_m(j_(m,n) rho)|; independent of n for n>=1. */
export const A_BY_M: readonly number[] = Object.freeze([
  1,
  0.5818652242815964,
  0.4864986822690033,
  0.4343944268405248,
  0.3996519741229633,
  0.3740929015451424,
  0.3541406291505494,
  0.3379317524463901,
  0.3243806324042235
]);

/** Arguments of the first positive extrema used to validate A_BY_M. */
export const PEAK_ARGUMENT_BY_M: readonly number[] = Object.freeze([
  0,
  1.84118378134066,
  3.05423692822714,
  4.201188941210528,
  5.317553126083994,
  6.415616375700241,
  7.501266144684148,
  8.577836489714073,
  9.647421651997217
]);

const MAX_BESSEL_ORDER = 9;
const SERIES_LIMIT = 12;
const SERIES_MAX_TERMS = 256;
const HANKEL_MAX_TERMS = 128;
const UNIT_DISK_TOLERANCE = 32 * Number.EPSILON;

const FACTORIALS: readonly number[] = Object.freeze([
  1,
  1,
  2,
  6,
  24,
  120,
  720,
  5040,
  40320,
  362880
]);

export function isAzimuthalModeIndex(value: number): value is AzimuthalModeIndex {
  return (
    Number.isInteger(value) &&
    value >= MIN_AZIMUTHAL_MODE_INDEX &&
    value <= MAX_AZIMUTHAL_MODE_INDEX
  );
}

export function isRadialModeIndex(value: number): value is RadialModeIndex {
  return (
    Number.isInteger(value) && value >= MIN_RADIAL_MODE_INDEX && value <= MAX_RADIAL_MODE_INDEX
  );
}

export function isModeSelection(value: unknown): value is ModeSelection {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as { readonly m?: unknown; readonly n?: unknown };
  return (
    typeof candidate.m === "number" &&
    typeof candidate.n === "number" &&
    isAzimuthalModeIndex(candidate.m) &&
    isRadialModeIndex(candidate.n)
  );
}

export function assertModeSelection(value: unknown): asserts value is ModeSelection {
  if (typeof value !== "object" || value === null) {
    throw new RangeError("mode must contain valid integer m and n indices.");
  }
  const candidate = value as { readonly m?: unknown; readonly n?: unknown };
  if (typeof candidate.m !== "number" || typeof candidate.n !== "number") {
    throw new RangeError("mode must contain numeric m and n indices.");
  }
  assertAzimuthalModeIndex(candidate.m, "m");
  assertRadialModeIndex(candidate.n, "n");
}

export function createModeSelection(m: number, n: number): Readonly<ModeSelection> {
  assertAzimuthalModeIndex(m, "m");
  assertRadialModeIndex(n, "n");
  return Object.freeze({ m, n });
}

/** Return the embedded positive Bessel zero j_(m,n). */
export function besselZero(m: AzimuthalModeIndex, n: RadialModeIndex): number {
  assertAzimuthalModeIndex(m, "m");
  assertRadialModeIndex(n, "n");
  const zero = BESSEL_ZEROS[m]?.[n - 1];
  if (zero === undefined) {
    throw new RangeError(`No embedded Bessel zero for m=${m}, n=${n}.`);
  }
  return zero;
}

/** Modal zero ratio j_(m,n)/j_(0,1), used only to scale illustrative animation. */
export function frequencyRatioToFundamental(mode: ModeSelection): number {
  assertModeSelection(mode);
  return besselZero(mode.m, mode.n) / besselZero(0, 1);
}

/** Illustrative cycle duration whose inverse follows the modal Bessel-zero ratio. */
export function animationCycleSeconds(mode: ModeSelection): number {
  return FUNDAMENTAL_CYCLE_SECONDS / frequencyRatioToFundamental(mode);
}

/**
 * Cylindrical Bessel J for integer orders 0,...,9.
 *
 * A compensated power series is used through |x|=12. Above that bound, J0 and
 * J1 use optimally truncated Hankel expansions and higher orders use the stable
 * forward recurrence J_(k+1)=2k J_k/x-J_(k-1).
 */
export function besselJ(order: number, x: number): number {
  assertBesselOrder(order);
  assertFinite(x, "x");

  const magnitude = Math.abs(x);
  const value =
    magnitude <= SERIES_LIMIT
      ? besselJSeries(order, magnitude)
      : besselJFromHankel(order, magnitude);
  return x < 0 && order % 2 === 1 ? -value : value;
}

/** Derivative dJ_m(x)/dx for integer orders 0,...,9. */
export function besselJDerivative(order: number, x: number): number {
  assertBesselOrder(order);
  assertFinite(x, "x");

  if (x === 0) {
    return order === 1 ? 0.5 : 0;
  }

  const magnitude = Math.abs(x);
  const positiveDerivative =
    order === 0
      ? -besselJ(1, magnitude)
      : besselJ(order - 1, magnitude) - (order * besselJ(order, magnitude)) / magnitude;
  return x < 0 && order % 2 === 0 ? -positiveDerivative : positiveDerivative;
}

/** Peak-normalized radial factor J_m(j_(m,n) rho)/A_m on 0<=rho<=1. */
export function normalizedRadialMode(rho: number, mode: ModeSelection): number {
  const radius = normalizeUnitRadius(rho);
  assertModeSelection(mode);
  if (radius === 1) {
    return 0;
  }
  const amplitude = peakAmplitude(mode.m);
  return besselJ(mode.m, besselZero(mode.m, mode.n) * radius) / amplitude;
}

/** Derivative of normalizedRadialMode with respect to normalized radius rho. */
export function normalizedRadialDerivative(rho: number, mode: ModeSelection): number {
  const radius = normalizeUnitRadius(rho);
  assertModeSelection(mode);
  const alpha = besselZero(mode.m, mode.n);
  return (alpha * besselJDerivative(mode.m, alpha * radius)) / peakAmplitude(mode.m);
}

/**
 * Peak-normalized cosine representative on the unit disk:
 * J_m(j_(m,n) rho) cos(m theta) / A_m.
 */
export function spatialMode(rho: number, theta: number, mode: ModeSelection): number {
  assertFinite(theta, "theta");
  const radial = normalizedRadialMode(rho, mode);
  return radial === 0 ? 0 : radial * Math.cos(mode.m * theta);
}

/** Partial derivative of spatialMode with respect to normalized radius rho. */
export function radialDerivative(rho: number, theta: number, mode: ModeSelection): number {
  const radius = normalizeUnitRadius(rho);
  assertFinite(theta, "theta");
  assertModeSelection(mode);
  return normalizedRadialDerivative(radius, mode) * Math.cos(mode.m * theta);
}

/** Polar coordinate derivatives (d phi/d rho, d phi/d theta). */
export function spatialGradient(
  rho: number,
  theta: number,
  mode: ModeSelection
): Readonly<PolarGradient> {
  const radius = normalizeUnitRadius(rho);
  assertFinite(theta, "theta");
  assertModeSelection(mode);
  const radial = normalizedRadialMode(radius, mode);
  return Object.freeze({
    dRho: radialDerivative(radius, theta, mode),
    dTheta: -mode.m * radial * Math.sin(mode.m * theta)
  });
}

/**
 * Cartesian gradient on the normalized unit disk. The cosine representative
 * is oriented so the m=1 center gradient points along +x.
 */
export function cartesianGradient(
  x: number,
  y: number,
  mode: ModeSelection
): Readonly<CartesianGradient> {
  assertFinite(x, "x");
  assertFinite(y, "y");
  assertModeSelection(mode);
  const rawRadius = Math.hypot(x, y);
  const radius = normalizeUnitRadius(rawRadius);

  if (radius === 0) {
    if (mode.m === 1) {
      return Object.freeze({
        dx: besselZero(mode.m, mode.n) / (2 * peakAmplitude(mode.m)),
        dy: 0
      });
    }
    return Object.freeze({ dx: 0, dy: 0 });
  }

  const theta = Math.atan2(y, x);
  const { dRho, dTheta } = spatialGradient(radius, theta, mode);
  const cosTheta = x / rawRadius;
  const sinTheta = y / rawRadius;
  const tangential = dTheta / radius;
  return Object.freeze({
    dx: cosTheta * dRho - sinTheta * tangential,
    dy: sinTheta * dRho + cosTheta * tangential
  });
}

/** Illustrative standing-wave displacement; phase is not physical browser time. */
export function displacement(
  rho: number,
  theta: number,
  phase: number,
  mode: ModeSelection,
  amplitude = DEFAULT_WAVE_PARAMETERS.amplitude
): number {
  assertFinite(phase, "phase");
  assertFinite(amplitude, "amplitude");
  return amplitude * spatialMode(rho, theta, mode) * Math.cos(phase);
}

/** Interior nodal-circle radii, normalized by membrane radius R. */
export function interiorNodalRadii(mode: ModeSelection): readonly number[] {
  assertModeSelection(mode);
  const selectedZero = besselZero(mode.m, mode.n);
  return Object.freeze(
    Array.from({ length: mode.n - 1 }, (_, index) => {
      const radialIndex = (index + 1) as RadialModeIndex;
      return besselZero(mode.m, radialIndex) / selectedZero;
    })
  );
}

/** Nodal-diameter orientations theta=(2q+1)pi/(2m), represented modulo pi. */
export function nodalDiameterAngles(m: AzimuthalModeIndex): readonly number[] {
  assertAzimuthalModeIndex(m, "m");
  if (m === 0) {
    return Object.freeze([]);
  }
  return Object.freeze(
    Array.from({ length: m }, (_, q) => ((2 * q + 1) * Math.PI) / (2 * m))
  );
}

export function nodalPattern(mode: ModeSelection): Readonly<NodalPattern> {
  assertModeSelection(mode);
  const circleRadii = interiorNodalRadii(mode);
  const diameterAngles = nodalDiameterAngles(mode.m);
  return Object.freeze({
    circleRadii,
    diameterAngles,
    circleCount: circleRadii.length,
    diameterCount: diameterAngles.length,
    totalCount: circleRadii.length + diameterAngles.length
  });
}

export function describeMode(mode: ModeSelection): string {
  assertModeSelection(mode);
  const pattern = nodalPattern(mode);
  return `Mode (${mode.m}, ${mode.n}) has ${countPhrase(
    pattern.circleCount,
    "interior nodal circle"
  )} and ${countPhrase(pattern.diameterCount, "nodal diameter")}.`;
}

export function resolveWaveParameters(
  parameters: Partial<WaveParameters> = {}
): Readonly<WaveParameters> {
  const resolved: WaveParameters = {
    amplitude: parameters.amplitude ?? DEFAULT_WAVE_PARAMETERS.amplitude,
    phase: parameters.phase ?? DEFAULT_WAVE_PARAMETERS.phase
  };
  assertFinite(resolved.amplitude, "amplitude");
  assertFinite(resolved.phase, "phase");
  return Object.freeze(resolved);
}

function besselJSeries(order: number, x: number): number {
  if (x === 0) {
    return order === 0 ? 1 : 0;
  }

  const factorial = FACTORIALS[order];
  if (factorial === undefined) {
    throw new RangeError(`Missing factorial for Bessel order ${order}.`);
  }
  let term = (x / 2) ** order / factorial;
  let sum = term;
  let compensation = 0;
  const quarterSquare = (x * x) / 4;

  for (let k = 1; k <= SERIES_MAX_TERMS; k += 1) {
    term *= -quarterSquare / (k * (k + order));
    const corrected = term - compensation;
    const next = sum + corrected;
    compensation = next - sum - corrected;
    sum = next;
    if (Math.abs(term) <= Number.EPSILON * Math.max(1, Math.abs(sum))) {
      return sum;
    }
  }

  throw new Error(`Bessel J_${order} series did not converge at x=${x}.`);
}

function besselJFromHankel(order: number, x: number): number {
  const j0 = hankelBase(0, x);
  if (order === 0) {
    return j0;
  }
  const j1 = hankelBase(1, x);
  if (order === 1) {
    return j1;
  }

  let previous = j0;
  let current = j1;
  for (let k = 1; k < order; k += 1) {
    const next = (2 * k * current) / x - previous;
    previous = current;
    current = next;
  }
  return current;
}

function hankelBase(order: 0 | 1, x: number): number {
  const mu = 4 * order * order;
  let scaledCoefficient = 1;
  let p = 1;
  let q = 0;
  let previousEvenMagnitude = Number.POSITIVE_INFINITY;
  let previousOddMagnitude = Number.POSITIVE_INFINITY;
  let useEvenTerms = true;
  let useOddTerms = true;

  for (let k = 1; k <= HANKEL_MAX_TERMS; k += 1) {
    const oddNumber = 2 * k - 1;
    scaledCoefficient *= (mu - oddNumber * oddNumber) / (k * 8 * x);
    const magnitude = Math.abs(scaledCoefficient);
    const seriesIndex = Math.floor(k / 2);
    const contribution = (seriesIndex % 2 === 0 ? 1 : -1) * scaledCoefficient;

    if (k % 2 === 0) {
      if (useEvenTerms && magnitude < previousEvenMagnitude) {
        p += contribution;
        previousEvenMagnitude = magnitude;
      } else {
        useEvenTerms = false;
      }
    } else if (useOddTerms && magnitude < previousOddMagnitude) {
      q += contribution;
      previousOddMagnitude = magnitude;
    } else {
      useOddTerms = false;
    }

    if (!useEvenTerms && !useOddTerms) {
      break;
    }
  }

  const phase = x - (order * Math.PI) / 2 - Math.PI / 4;
  return Math.sqrt(2 / (Math.PI * x)) * (Math.cos(phase) * p - Math.sin(phase) * q);
}

function peakAmplitude(m: AzimuthalModeIndex): number {
  const amplitude = A_BY_M[m];
  if (amplitude === undefined) {
    throw new RangeError(`No normalization amplitude for m=${m}.`);
  }
  return amplitude;
}

function normalizeUnitRadius(radius: number): number {
  assertFinite(radius, "rho");
  if (radius < 0 || radius > 1 + UNIT_DISK_TOLERANCE) {
    throw new RangeError("rho must lie in the normalized interval [0, 1].");
  }
  return radius > 1 ? 1 : radius;
}

function assertAzimuthalModeIndex(
  value: number,
  label: string
): asserts value is AzimuthalModeIndex {
  if (!isAzimuthalModeIndex(value)) {
    throw new RangeError(
      `${label} must be an integer from ${AZIMUTHAL_MODE_INDICES[0]} to ${AZIMUTHAL_MODE_INDICES.at(-1)}.`
    );
  }
}

function assertRadialModeIndex(value: number, label: string): asserts value is RadialModeIndex {
  if (!isRadialModeIndex(value)) {
    throw new RangeError(
      `${label} must be an integer from ${RADIAL_MODE_INDICES[0]} to ${RADIAL_MODE_INDICES.at(-1)}.`
    );
  }
}

function assertBesselOrder(order: number): void {
  if (!Number.isInteger(order) || order < 0 || order > MAX_BESSEL_ORDER) {
    throw new RangeError(`order must be an integer from 0 to ${MAX_BESSEL_ORDER}.`);
  }
}

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${label} must be finite.`);
  }
}

function countPhrase(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}
