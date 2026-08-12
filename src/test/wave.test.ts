import { describe, expect, it } from "vitest";

import type { ModeSelection } from "../types";

import {
  A_BY_M,
  AZIMUTHAL_MODE_INDICES,
  BESSEL_ZEROS,
  DEFAULT_MODE,
  FUNDAMENTAL_CYCLE_SECONDS,
  PEAK_ARGUMENT_BY_M,
  RADIAL_MODE_INDICES,
  animationCycleSeconds,
  assertModeSelection,
  besselJ,
  besselJDerivative,
  besselZero,
  cartesianGradient,
  createModeSelection,
  describeMode,
  displacement,
  frequencyRatioToFundamental,
  interiorNodalRadii,
  isAzimuthalModeIndex,
  isModeSelection,
  isRadialModeIndex,
  nodalDiameterAngles,
  nodalPattern,
  normalizedRadialDerivative,
  normalizedRadialMode,
  spatialGradient,
  spatialMode
} from "../math";

describe("circular membrane mode indices", () => {
  it("uses frozen mode (2, 3) by default", () => {
    expect(DEFAULT_MODE).toEqual({ m: 2, n: 3 });
    expect(Object.isFrozen(DEFAULT_MODE)).toBe(true);
  });

  it("validates azimuthal and radial indices independently", () => {
    expect(isAzimuthalModeIndex(0)).toBe(true);
    expect(isAzimuthalModeIndex(8)).toBe(true);
    expect(isAzimuthalModeIndex(9)).toBe(false);
    expect(isRadialModeIndex(1)).toBe(true);
    expect(isRadialModeIndex(8)).toBe(true);
    expect(isRadialModeIndex(0)).toBe(false);
    expect(createModeSelection(0, 8)).toEqual({ m: 0, n: 8 });
    expect(Object.isFrozen(createModeSelection(8, 1))).toBe(true);
    expect(isModeSelection({ m: 4, n: 2 })).toBe(true);
    expect(isModeSelection({ m: 4, n: 0 })).toBe(false);
    expect(isModeSelection(null)).toBe(false);
    expect(() => createModeSelection(-1, 2)).toThrow(RangeError);
    expect(() => createModeSelection(2, 9)).toThrow(RangeError);
    expect(() => assertModeSelection(null)).toThrow(RangeError);
    expect(() => assertModeSelection({ m: 2 })).toThrow(RangeError);
    expect(() => assertModeSelection({ m: 2, n: 0 } as never)).toThrow(RangeError);
  });
});

describe("embedded Bessel data and evaluator", () => {
  it("contains an immutable 9 by 8 table with the expected endpoints", () => {
    expect(BESSEL_ZEROS).toHaveLength(9);
    for (const row of BESSEL_ZEROS) {
      expect(row).toHaveLength(8);
      expect(Object.isFrozen(row)).toBe(true);
    }
    expect(Object.isFrozen(BESSEL_ZEROS)).toBe(true);
    expect(BESSEL_ZEROS[0]?.[0]).toBe(2.404825557695772);
    expect(BESSEL_ZEROS[8]?.[7]).toBe(36.02561506386957);
    expect(A_BY_M).toHaveLength(9);
    expect(PEAK_ARGUMENT_BY_M).toHaveLength(9);
  });

  it("matches independent high-precision reference values", () => {
    const references = [
      [0, 0, 1],
      [0, 1, 0.7651976865579666],
      [1, 1, 0.4400505857449335],
      [2, 5, 0.046565116277752216],
      [8, 12, 0.04509532908045724],
      [9, 12.0000001, 0.23038089679878202],
      [0, 12.5, 0.1468840547004211],
      [1, 12.5, -0.16548380461475972],
      [5, 20, 0.15116976798239498],
      [9, 36, -0.13207210146491457]
    ] as const;

    for (const [order, x, expected] of references) {
      expect(Math.abs(besselJ(order, x) - expected)).toBeLessThan(2e-11);
    }
    expect(besselJ(3, -5)).toBeCloseTo(-besselJ(3, 5), 14);
    expect(besselJ(4, -5)).toBeCloseTo(besselJ(4, 5), 14);
  });

  it("matches derivative reference values and center limits", () => {
    const references = [
      [0, 1, -0.4400505857449335],
      [1, 1, 0.32514710081303305],
      [2, 5, -0.3462051841025661],
      [8, 12, -0.20031735684751287],
      [0, 12.5, 0.16548380461475973],
      [5, 20, 0.0928784915592645],
      [9, 36, 0.029654632389716908]
    ] as const;

    expect(besselJDerivative(0, 0)).toBe(0);
    expect(besselJDerivative(1, 0)).toBe(0.5);
    expect(besselJDerivative(8, 0)).toBe(0);
    for (const [order, x, expected] of references) {
      expect(Math.abs(besselJDerivative(order, x) - expected)).toBeLessThan(2e-11);
    }
  });

  it("resolves every embedded zero with residual below 1e-10", () => {
    for (const m of AZIMUTHAL_MODE_INDICES) {
      for (const n of RADIAL_MODE_INDICES) {
        const zero = besselZero(m, n);
        expect(Math.abs(besselJ(m, zero)), `residual for j_(${m},${n})`).toBeLessThan(1e-10);
      }
    }
  });

  it("rejects unsupported orders and non-finite arguments", () => {
    expect(() => besselJ(-1, 2)).toThrow(RangeError);
    expect(() => besselJ(10, 2)).toThrow(RangeError);
    expect(() => besselJ(1.5, 2)).toThrow(RangeError);
    expect(() => besselJ(2, Number.NaN)).toThrow(RangeError);
    expect(() => besselJDerivative(2, Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe("modal animation timing", () => {
  it("assigns a ten-second cycle and unit ratio to the fundamental mode", () => {
    const fundamental = createModeSelection(0, 1);
    expect(FUNDAMENTAL_CYCLE_SECONDS).toBe(10);
    expect(frequencyRatioToFundamental(fundamental)).toBe(1);
    expect(animationCycleSeconds(fundamental)).toBe(10);
  });

  it("derives the default and maximum-mode timing from their Bessel zeros", () => {
    const defaultRatio = frequencyRatioToFundamental(DEFAULT_MODE);
    const maximumMode = createModeSelection(8, 8);
    const maximumRatio = frequencyRatioToFundamental(maximumMode);

    expect(defaultRatio).toBeCloseTo(4.8318852629306, 14);
    expect(animationCycleSeconds(DEFAULT_MODE)).toBeCloseTo(2.0695855666769027, 14);
    expect(maximumRatio).toBeCloseTo(14.98055231015932, 14);
    expect(animationCycleSeconds(maximumMode)).toBeCloseTo(0.6675321305222056, 14);
    expect(defaultRatio).toBe(besselZero(2, 3) / besselZero(0, 1));
    expect(maximumRatio).toBe(besselZero(8, 8) / besselZero(0, 1));
  });

  it("increases ratios and decreases cycles as either modal index increases", () => {
    for (const m of AZIMUTHAL_MODE_INDICES) {
      let previousRatio = 0;
      let previousCycle = Number.POSITIVE_INFINITY;
      for (const n of RADIAL_MODE_INDICES) {
        const mode = createModeSelection(m, n);
        const ratio = frequencyRatioToFundamental(mode);
        const cycle = animationCycleSeconds(mode);
        expect(ratio).toBeGreaterThan(previousRatio);
        expect(cycle).toBeLessThan(previousCycle);
        expect(ratio * cycle).toBeCloseTo(FUNDAMENTAL_CYCLE_SECONDS, 14);
        previousRatio = ratio;
        previousCycle = cycle;
      }
    }

    for (const n of RADIAL_MODE_INDICES) {
      let previousRatio = 0;
      for (const m of AZIMUTHAL_MODE_INDICES) {
        const ratio = frequencyRatioToFundamental(createModeSelection(m, n));
        expect(ratio).toBeGreaterThan(previousRatio);
        previousRatio = ratio;
      }
    }
  });

  it("validates the mode before calculating timing", () => {
    expect(() => frequencyRatioToFundamental({ m: 9, n: 1 } as never)).toThrow(RangeError);
    expect(() => animationCycleSeconds({ m: 0, n: 0 } as never)).toThrow(RangeError);
  });
});

describe("peak-normalized circular eigenmodes", () => {
  it("reaches unit radial amplitude for every supported mode", () => {
    for (const m of AZIMUTHAL_MODE_INDICES) {
      const peakArgument = PEAK_ARGUMENT_BY_M[m];
      expect(peakArgument).toBeDefined();
      for (const n of RADIAL_MODE_INDICES) {
        const mode = createModeSelection(m, n);
        const rho = (peakArgument ?? 0) / besselZero(m, n);
        expect(normalizedRadialMode(rho, mode)).toBeCloseTo(1, 10);
        expect(spatialMode(rho, 0, mode)).toBeCloseTo(1, 10);
      }
    }
  });

  it("enforces the fixed perimeter exactly for all 72 modes", () => {
    for (const m of AZIMUTHAL_MODE_INDICES) {
      for (const n of RADIAL_MODE_INDICES) {
        const mode = createModeSelection(m, n);
        expect(normalizedRadialMode(1, mode)).toBe(0);
        for (const theta of [0, 0.37, Math.PI / 2, Math.PI, 5.91]) {
          expect(spatialMode(1, theta, mode)).toBe(0);
        }
      }
    }
  });

  it("makes axisymmetric modes independent of theta", () => {
    const mode = createModeSelection(0, 5);
    const expected = spatialMode(0.37, 0, mode);
    for (const theta of [-9, 0.4, Math.PI, 100]) {
      expect(spatialMode(0.37, theta, mode)).toBe(expected);
    }
    expect(spatialMode(0, 2.4, mode)).toBe(1);
    expect(spatialMode(0, 2.4, createModeSelection(3, 1))).toBe(0);
  });

  it("uses illustrative phase without introducing a frequency law", () => {
    const mode = createModeSelection(2, 3);
    const rho = PEAK_ARGUMENT_BY_M[2]! / besselZero(2, 3);
    expect(displacement(rho, 0, 0, mode)).toBeCloseTo(1, 10);
    expect(displacement(rho, 0, Math.PI / 2, mode)).toBeCloseTo(0, 12);
    expect(displacement(rho, 0, Math.PI, mode, 0.4)).toBeCloseTo(-0.4, 10);
  });

  it("keeps distinct radial modes orthogonal with weight rho", () => {
    const pairs = [
      [createModeSelection(0, 1), createModeSelection(0, 2)],
      [createModeSelection(4, 3), createModeSelection(4, 7)],
      [createModeSelection(8, 7), createModeSelection(8, 8)]
    ] as const;

    for (const [first, second] of pairs) {
      const cells = 4096;
      let integral = 0;
      for (let index = 0; index < cells; index += 1) {
        const rho = (index + 0.5) / cells;
        integral +=
          rho * normalizedRadialMode(rho, first) * normalizedRadialMode(rho, second);
      }
      integral /= cells;
      expect(Math.abs(integral)).toBeLessThan(5e-6);
    }
  });

  it("rejects points outside the normalized disk", () => {
    const mode = createModeSelection(2, 3);
    expect(() => spatialMode(-0.01, 0, mode)).toThrow(RangeError);
    expect(() => spatialMode(1.01, 0, mode)).toThrow(RangeError);
    expect(() => spatialMode(0.2, Number.NaN, mode)).toThrow(RangeError);
    expect(() => cartesianGradient(0.8, 0.8, mode)).toThrow(RangeError);
    expect(() => displacement(0.2, 0, Number.NaN, mode)).toThrow(RangeError);
  });
});

describe("nodal metadata", () => {
  it("derives interior circle ratios from Bessel zeros", () => {
    const mode = createModeSelection(2, 3);
    const radii = interiorNodalRadii(mode);
    expect(radii).toHaveLength(2);
    expect(radii[0]).toBeCloseTo(besselZero(2, 1) / besselZero(2, 3), 14);
    expect(radii[1]).toBeCloseTo(besselZero(2, 2) / besselZero(2, 3), 14);
    expect(Object.isFrozen(radii)).toBe(true);
    for (const rho of radii) {
      expect(Math.abs(spatialMode(rho, 0, mode))).toBeLessThan(1e-10);
    }
  });

  it("reports m diameter orientations and none for m=0", () => {
    expect(nodalDiameterAngles(0)).toEqual([]);
    expect(nodalDiameterAngles(2)).toEqual([Math.PI / 4, (3 * Math.PI) / 4]);
    const angles = nodalDiameterAngles(4);
    expect(angles).toHaveLength(4);
    for (const theta of angles) {
      expect(Math.abs(spatialMode(0.4, theta, createModeSelection(4, 1)))).toBeLessThan(1e-12);
    }
  });

  it("provides frozen counts and an accessible description", () => {
    const pattern = nodalPattern(createModeSelection(2, 3));
    expect(pattern).toMatchObject({ circleCount: 2, diameterCount: 2, totalCount: 4 });
    expect(Object.isFrozen(pattern)).toBe(true);
    expect(describeMode(createModeSelection(2, 3))).toBe(
      "Mode (2, 3) has 2 interior nodal circles and 2 nodal diameters."
    );
    expect(describeMode(createModeSelection(0, 1))).toBe(
      "Mode (0, 1) has 0 interior nodal circles and 0 nodal diameters."
    );
  });
});

describe("analytic gradients", () => {
  it("matches finite differences in polar coordinates", () => {
    const cases = [
      [createModeSelection(0, 3), 0.31, 0.7],
      [createModeSelection(1, 2), 0.46, -0.8],
      [createModeSelection(5, 7), 0.73, 1.1],
      [createModeSelection(8, 8), 0.28, 2.2]
    ] as const;
    const h = 1e-6;

    for (const [mode, rho, theta] of cases) {
      const gradient = spatialGradient(rho, theta, mode);
      const radialFiniteDifference =
        (spatialMode(rho + h, theta, mode) - spatialMode(rho - h, theta, mode)) / (2 * h);
      const angularFiniteDifference =
        (spatialMode(rho, theta + h, mode) - spatialMode(rho, theta - h, mode)) / (2 * h);
      const radialFactorFiniteDifference =
        (normalizedRadialMode(rho + h, mode) - normalizedRadialMode(rho - h, mode)) /
        (2 * h);

      expect(Math.abs(gradient.dRho - radialFiniteDifference)).toBeLessThan(2e-5);
      expect(Math.abs(gradient.dTheta - angularFiniteDifference)).toBeLessThan(2e-5);
      expect(
        Math.abs(normalizedRadialDerivative(rho, mode) - radialFactorFiniteDifference)
      ).toBeLessThan(2e-5);
    }
  });

  it("matches finite differences in Cartesian coordinates", () => {
    const cases = [
      [createModeSelection(0, 2), 0.23, -0.31],
      [createModeSelection(1, 4), -0.42, 0.19],
      [createModeSelection(6, 7), 0.37, 0.51]
    ] as const;
    const h = 1e-6;
    const valueAt = (x: number, y: number, mode: ModeSelection): number =>
      spatialMode(Math.hypot(x, y), Math.atan2(y, x), mode);

    for (const [mode, x, y] of cases) {
      const gradient = cartesianGradient(x, y, mode);
      const dx = (valueAt(x + h, y, mode) - valueAt(x - h, y, mode)) / (2 * h);
      const dy = (valueAt(x, y + h, mode) - valueAt(x, y - h, mode)) / (2 * h);
      expect(Math.abs(gradient.dx - dx)).toBeLessThan(2e-5);
      expect(Math.abs(gradient.dy - dy)).toBeLessThan(2e-5);
    }
  });

  it("uses the analytic center limits for every azimuthal case", () => {
    expect(cartesianGradient(0, 0, createModeSelection(0, 4))).toEqual({ dx: 0, dy: 0 });
    const modeOne = createModeSelection(1, 3);
    expect(cartesianGradient(0, 0, modeOne)).toEqual({
      dx: besselZero(1, 3) / (2 * A_BY_M[1]!),
      dy: 0
    });
    expect(cartesianGradient(0, 0, createModeSelection(2, 8))).toEqual({ dx: 0, dy: 0 });
    expect(cartesianGradient(0, 0, createModeSelection(8, 8))).toEqual({ dx: 0, dy: 0 });
  });
});
