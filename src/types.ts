/** Allowed azimuthal orders m. */
export const AZIMUTHAL_MODE_INDICES = [0, 1, 2, 3, 4, 5, 6, 7, 8] as const;

/** Allowed positive radial indices n. */
export const RADIAL_MODE_INDICES = [1, 2, 3, 4, 5, 6, 7, 8] as const;

export type AzimuthalModeIndex = (typeof AZIMUTHAL_MODE_INDICES)[number];
export type RadialModeIndex = (typeof RADIAL_MODE_INDICES)[number];

/** Compatibility union for UI controls whose axis determines the narrower type. */
export type ModeIndex = AzimuthalModeIndex | RadialModeIndex;
export type ModeAxis = "m" | "n";

export interface ModeSelection {
  /** Azimuthal Bessel order. */
  readonly m: AzimuthalModeIndex;
  /** One-based index of the positive Bessel zero. */
  readonly n: RadialModeIndex;
}

/** A semantic alias used by renderers that consume a selected membrane mode. */
export type MembraneMode = ModeSelection;

export const PLAYBACK_RATES = [0.5, 1, 2] as const;

export type PlaybackRate = (typeof PLAYBACK_RATES)[number];

export interface WaveParameters {
  /** Peak displacement multiplier. */
  readonly amplitude: number;
  /** Illustrative temporal phase, in radians. */
  readonly phase: number;
}

export interface PolarGradient {
  /** Partial derivative with respect to normalized radius rho. */
  readonly dRho: number;
  /** Partial derivative with respect to the polar angle theta. */
  readonly dTheta: number;
}

export interface CartesianGradient {
  /** Partial derivative with respect to normalized Cartesian x. */
  readonly dx: number;
  /** Partial derivative with respect to normalized Cartesian y. */
  readonly dy: number;
}

export interface NodalPattern {
  /** Interior nodal-circle radii divided by the membrane radius R. */
  readonly circleRadii: readonly number[];
  /** Nodal-diameter orientations in radians, each represented modulo pi. */
  readonly diameterAngles: readonly number[];
  readonly circleCount: number;
  readonly diameterCount: number;
  readonly totalCount: number;
}

export interface ControllerState {
  readonly mode: ModeSelection;
  readonly isPlaying: boolean;
  readonly playbackRate: PlaybackRate;
  readonly isUiVisible: boolean;
  readonly prefersReducedMotion: boolean;
}
