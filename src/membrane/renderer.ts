import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import {
  animationCycleSeconds,
  frequencyRatioToFundamental,
  nodalPattern,
  normalizedRadialDerivative,
  normalizedRadialMode
} from "../math";
import type { MembraneMode, PlaybackRate } from "../types";
import { createBerlinTexture } from "./berlin";

export const DISK_RADIUS = 0.5;
export const RADIAL_RINGS = 128;
export const ANGULAR_SECTORS = 256;
export const DISK_VERTEX_COUNT = 1 + RADIAL_RINGS * ANGULAR_SECTORS;
export const DISK_TRIANGLE_COUNT =
  ANGULAR_SECTORS + (RADIAL_RINGS - 1) * ANGULAR_SECTORS * 2;
export const POLAR_GRID_RING_DIVISIONS = 16;
export const POLAR_GRID_SPOKE_COUNT = 32;
export const POLAR_GRID_LINE_WIDTH_PIXELS = 1;
export const POLAR_GRID_OPACITY = 0.32;

const MAX_PIXEL_RATIO = 2;
const MAX_DRAWING_BUFFER_PIXELS = 2_500_000;
const TWO_PI = 2 * Math.PI;
const DEFAULT_CAMERA_DIRECTION = new THREE.Vector3(1.28, 1.02, 1.38).normalize();
const DEFAULT_CAMERA_DISTANCE = 2.15;
const DEFAULT_MODE: MembraneMode = { m: 2, n: 3 };

export const MEMBRANE_AMPLITUDE = 0.09;

export interface ThreeMembraneRendererOptions {
  readonly onContextLost?: () => void;
  readonly onContextRestored?: () => void;
}

interface MembraneUniforms {
  readonly [name: string]: THREE.IUniform;
  readonly uAmplitude: THREE.IUniform<number>;
  readonly uBerlin: THREE.IUniform<THREE.DataTexture>;
  readonly uPhase: THREE.IUniform<number>;
}

export interface CircularModeAttributeData {
  readonly shape: Float32Array;
  readonly fx: Float32Array;
  readonly fz: Float32Array;
}

/**
 * Retained WebGL renderer for a fixed-edge circular membrane.
 *
 * The indexed disk and its attributes are allocated once. Selecting a mode
 * updates the existing shape and gradient buffers; animation changes only the
 * phase uniform. Frames are requested only while animation or damped camera
 * motion is active.
 */
export class MembraneRenderer {
  private readonly host: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(34, 1, 0.05, 20);
  private readonly controls: OrbitControls;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.ShaderMaterial;
  private readonly membrane: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly berlinTexture: THREE.DataTexture;
  private readonly uniforms: MembraneUniforms;
  private readonly perimeter: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>;
  private readonly perimeterGeometry: THREE.TorusGeometry;
  private readonly perimeterMaterial: THREE.MeshBasicMaterial;
  private readonly resizeObserver: ResizeObserver | null;
  private readonly onContextLostCallback: (() => void) | undefined;
  private readonly onContextRestoredCallback: (() => void) | undefined;

  private mode: MembraneMode = DEFAULT_MODE;
  private cycleSeconds = animationCycleSeconds(DEFAULT_MODE);
  private frequencyRatio = frequencyRatioToFundamental(DEFAULT_MODE);
  private phase = 0;
  private playbackRate: PlaybackRate = 1;
  private playing = false;
  private pageVisible = true;
  private contextLost = false;
  private destroyed = false;
  private rafId = 0;
  private previousFrameTime: number | null = null;
  private frameSequence = 0;

  private readonly handleContextLost = (event: Event): void => {
    event.preventDefault();
    if (this.destroyed) return;
    this.contextLost = true;
    this.previousFrameTime = null;
    this.cancelFrame();
    this.host.dataset.membraneStatus = "context-lost";
    this.host.dispatchEvent(new CustomEvent("membrane-context-lost", { bubbles: true }));
    this.onContextLostCallback?.();
  };

  private readonly handleContextRestored = (): void => {
    if (this.destroyed) return;
    this.contextLost = false;
    this.previousFrameTime = null;
    this.host.dataset.membraneStatus = "ready";
    this.host.dispatchEvent(new CustomEvent("membrane-context-restored", { bubbles: true }));
    this.onContextRestoredCallback?.();
    this.requestFrame();
  };

  constructor(host: HTMLElement, options: ThreeMembraneRendererOptions = {}) {
    this.host = host;
    this.onContextLostCallback = options.onContextLost;
    this.onContextRestoredCallback = options.onContextRestored;

    this.renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      powerPreference: "high-performance",
      preserveDrawingBuffer: false
    });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.dataset.membraneCanvas = "true";
    this.renderer.domElement.setAttribute("aria-hidden", "true");
    host.replaceChildren(this.renderer.domElement);

    this.berlinTexture = createBerlinTexture();
    this.uniforms = {
      uAmplitude: { value: MEMBRANE_AMPLITUDE },
      uBerlin: { value: this.berlinTexture },
      uPhase: { value: 0 }
    };
    this.geometry = createCircularDiskGeometry();
    updateCircularModeAttributes(this.geometry, DEFAULT_MODE);
    this.material = new THREE.ShaderMaterial({
      name: "signed-membrane-berlin",
      uniforms: this.uniforms,
      vertexShader: MEMBRANE_VERTEX_SHADER,
      fragmentShader: MEMBRANE_FRAGMENT_SHADER,
      side: THREE.DoubleSide,
      toneMapped: false
    });
    this.membrane = new THREE.Mesh(this.geometry, this.material);
    this.membrane.name = "circular-membrane";
    this.membrane.frustumCulled = false;
    this.scene.add(this.membrane);

    const perimeter = createPerimeter();
    this.perimeter = perimeter.mesh;
    this.perimeterGeometry = perimeter.geometry;
    this.perimeterMaterial = perimeter.material;
    this.scene.add(this.perimeter);

    this.camera.position.copy(DEFAULT_CAMERA_DIRECTION).multiplyScalar(DEFAULT_CAMERA_DISTANCE);
    this.camera.lookAt(0, 0, 0);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.075;
    this.controls.enablePan = false;
    this.controls.minDistance = 0.95;
    this.controls.maxDistance = 5;
    // Permit a complete orbit, including a view of the membrane underside.
    this.controls.minPolarAngle = 0;
    this.controls.maxPolarAngle = Math.PI;
    this.controls.rotateSpeed = 0.68;
    this.controls.zoomSpeed = 0.8;
    this.controls.target.set(0, 0, 0);
    this.controls.addEventListener("change", this.requestFrame);
    this.controls.addEventListener("change", this.updateCameraData);
    this.controls.update();

    this.renderer.domElement.addEventListener("webglcontextlost", this.handleContextLost);
    this.renderer.domElement.addEventListener("webglcontextrestored", this.handleContextRestored);
    if (typeof ResizeObserver === "undefined") {
      this.resizeObserver = null;
    } else {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(host);
    }

    this.host.dataset.rendererReady = "true";
    this.host.dataset.membraneStatus = "ready";
    this.host.dataset.meshSegments = `${RADIAL_RINGS}`;
    this.host.dataset.radialRings = `${RADIAL_RINGS}`;
    this.host.dataset.angularSectors = `${ANGULAR_SECTORS}`;
    this.host.dataset.vertexCount = `${DISK_VERTEX_COUNT}`;
    this.host.dataset.triangleCount = `${DISK_TRIANGLE_COUNT}`;
    this.host.dataset.frame = "0";
    this.host.dataset.playing = "false";
    this.host.dataset.playbackRate = "1";
    this.host.dataset.animationTiming = "modal";
    this.host.dataset.nodalOverlay = "false";
    this.host.dataset.pageVisible = "true";
    this.host.dataset.amplitude = `${MEMBRANE_AMPLITUDE}`;
    this.host.dataset.gridVisible = "true";
    this.host.dataset.axisMarkers = "false";
    this.host.dataset.cameraFullRotation = "true";
    this.host.setAttribute("aria-busy", "false");
    this.updateModeData();
    this.updatePhaseData();
    this.updateCameraData();
    this.resize();
  }

  setMode(mode: MembraneMode): void {
    if (this.destroyed) return;
    assertMode(mode);
    if (mode.m === this.mode.m && mode.n === this.mode.n) return;
    this.mode = mode;
    this.cycleSeconds = animationCycleSeconds(mode);
    this.frequencyRatio = frequencyRatioToFundamental(mode);
    updateCircularModeAttributes(this.geometry, mode);
    this.updateModeData();
    this.resetPhase();
  }

  setPlaying(playing: boolean): void {
    if (this.destroyed || playing === this.playing) return;
    this.playing = playing;
    this.previousFrameTime = null;
    this.host.dataset.playing = `${playing}`;
    if (playing && this.pageVisible && !this.contextLost) {
      this.requestFrame();
    }
  }

  setPlaybackRate(rate: PlaybackRate): void {
    if (this.destroyed) return;
    if (rate !== 0.5 && rate !== 1 && rate !== 2) {
      throw new RangeError(`Playback rate must be 0.5, 1, or 2; got ${String(rate)}`);
    }
    this.playbackRate = rate;
    this.host.dataset.playbackRate = `${rate}`;
    this.requestFrame();
  }

  setPageVisible(visible: boolean): void {
    if (this.destroyed || visible === this.pageVisible) return;
    this.pageVisible = visible;
    this.previousFrameTime = null;
    this.host.dataset.pageVisible = `${visible}`;
    if (visible) {
      this.requestFrame();
    } else {
      this.cancelFrame();
    }
  }

  resetPhase(): void {
    if (this.destroyed) return;
    this.phase = 0;
    this.previousFrameTime = null;
    this.uniforms.uPhase.value = 0;
    this.updatePhaseData();
    this.requestFrame();
  }

  resetView(): void {
    if (this.destroyed) return;
    const dampingWasEnabled = this.controls.enableDamping;
    // Clear any residual damped rotation so reset is exact and repeatable.
    this.controls.enableDamping = false;
    this.controls.update();
    this.controls.target.set(0, 0, 0);
    this.camera.position.copy(DEFAULT_CAMERA_DIRECTION).multiplyScalar(DEFAULT_CAMERA_DISTANCE);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.controls.target);
    this.controls.update();
    this.controls.enableDamping = dampingWasEnabled;
    this.updateCameraData();
    this.requestFrame();
  }

  rotateBy(deltaAzimuth: number, deltaPolar: number): void {
    if (this.destroyed || !Number.isFinite(deltaAzimuth) || !Number.isFinite(deltaPolar)) return;
    this.controls.rotateLeft(deltaAzimuth);
    this.controls.rotateUp(deltaPolar);
    this.controls.update();
    this.requestFrame();
  }

  zoomBy(scale: number): void {
    if (this.destroyed || !Number.isFinite(scale) || scale <= 0) return;
    const offset = this.camera.position.clone().sub(this.controls.target);
    const distance = THREE.MathUtils.clamp(
      offset.length() * scale,
      this.controls.minDistance,
      this.controls.maxDistance
    );
    offset.setLength(distance);
    this.camera.position.copy(this.controls.target).add(offset);
    this.controls.update();
    this.requestFrame();
  }

  /** Handle camera-only keyboard shortcuts when the stage owns focus. */
  handleKeyboard(event: KeyboardEvent): boolean {
    if (this.destroyed || event.altKey || event.ctrlKey || event.metaKey) return false;
    let handled = true;
    switch (event.key) {
      case "ArrowLeft":
        this.rotateBy(0.1, 0);
        break;
      case "ArrowRight":
        this.rotateBy(-0.1, 0);
        break;
      case "ArrowUp":
        this.rotateBy(0, 0.075);
        break;
      case "ArrowDown":
        this.rotateBy(0, -0.075);
        break;
      case "+":
      case "=":
        this.zoomBy(0.88);
        break;
      case "-":
      case "_":
        this.zoomBy(1.14);
        break;
      case "0":
      case "Home":
        this.resetView();
        break;
      default:
        handled = false;
    }
    if (handled) event.preventDefault();
    return handled;
  }

  resize(): void {
    if (this.destroyed) return;
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    const requestedRatio = Math.max(1, window.devicePixelRatio || 1);
    const bufferLimitedRatio = Math.sqrt(MAX_DRAWING_BUFFER_PIXELS / (width * height));
    const pixelRatio = Math.min(requestedRatio, MAX_PIXEL_RATIO, bufferLimitedRatio);
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.host.dataset.pixelRatio = pixelRatio.toFixed(3);
    this.requestFrame();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.cancelFrame();
    this.resizeObserver?.disconnect();
    this.controls.removeEventListener("change", this.requestFrame);
    this.controls.removeEventListener("change", this.updateCameraData);
    this.controls.dispose();
    this.renderer.domElement.removeEventListener("webglcontextlost", this.handleContextLost);
    this.renderer.domElement.removeEventListener("webglcontextrestored", this.handleContextRestored);
    this.geometry.dispose();
    this.material.dispose();
    this.berlinTexture.dispose();
    this.perimeterGeometry.dispose();
    this.perimeterMaterial.dispose();
    this.scene.clear();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    delete this.host.dataset.rendererReady;
    this.host.dataset.membraneStatus = "destroyed";
  }

  private readonly requestFrame = (): void => {
    if (this.destroyed || this.contextLost || !this.pageVisible || this.rafId !== 0) return;
    this.rafId = window.requestAnimationFrame(this.renderFrame);
  };

  private readonly renderFrame = (time: number): void => {
    this.rafId = 0;
    if (this.destroyed || this.contextLost || !this.pageVisible) return;

    if (this.playing) {
      if (this.previousFrameTime !== null) {
        const elapsedSeconds = Math.min(0.1, Math.max(0, (time - this.previousFrameTime) / 1000));
        this.phase =
          (this.phase + (elapsedSeconds * TWO_PI * this.playbackRate) / this.cycleSeconds) %
          TWO_PI;
        this.uniforms.uPhase.value = this.phase;
        this.updatePhaseData();
      }
      this.previousFrameTime = time;
    } else {
      this.previousFrameTime = null;
    }

    const cameraMoving = this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.frameSequence += 1;
    this.host.dataset.frame = `${this.frameSequence}`;
    const memory = this.renderer.info.memory;
    this.host.dataset.geometryCount = `${memory.geometries}`;
    this.host.dataset.textureCount = `${memory.textures}`;
    this.host.dataset.programCount = `${this.renderer.info.programs?.length ?? 0}`;
    if (this.playing || cameraMoving) this.requestFrame();
  };

  private readonly updateCameraData = (): void => {
    if (this.destroyed) return;
    const { x, y, z } = this.camera.position;
    this.host.dataset.camera = `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`;
  };

  private updateModeData(): void {
    const pattern = nodalPattern(this.mode);
    this.host.dataset.mode = `${this.mode.m},${this.mode.n}`;
    this.host.dataset.nodalCircleCount = `${pattern.circleCount}`;
    this.host.dataset.nodalDiameterCount = `${pattern.diameterCount}`;
    this.host.dataset.cycleSeconds = `${this.cycleSeconds}`;
    this.host.dataset.frequencyRatio = `${this.frequencyRatio}`;
  }

  private updatePhaseData(): void {
    this.host.dataset.phase = this.phase.toFixed(6);
  }

  private cancelFrame(): void {
    if (this.rafId === 0) return;
    window.cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }
}

/** Compatibility alias for callers that prefer the explicit Three.js name. */
export { MembraneRenderer as ThreeMembraneRenderer };

function assertMode(mode: MembraneMode): void {
  if (
    !Number.isInteger(mode.m) ||
    !Number.isInteger(mode.n) ||
    mode.m < 0 ||
    mode.m > 8 ||
    mode.n < 1 ||
    mode.n > 8
  ) {
    throw new RangeError(
      `Mode indices require an integer m from 0 to 8 and n from 1 to 8; got (${mode.m}, ${mode.n})`
    );
  }
}

interface PerimeterResources {
  readonly mesh: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>;
  readonly geometry: THREE.TorusGeometry;
  readonly material: THREE.MeshBasicMaterial;
}

/**
 * Create a retained indexed disk without an angular seam duplicate.
 *
 * The single centre vertex is followed by 256 vertices for each of the 128
 * radial rings. Triangles are wound counter-clockwise when viewed from +Y.
 */
export function createCircularDiskGeometry(): THREE.BufferGeometry {
  const positions = new Float32Array(DISK_VERTEX_COUNT * 3);
  const uvs = new Float32Array(DISK_VERTEX_COUNT * 2);
  const indices = new Uint16Array(DISK_TRIANGLE_COUNT * 3);

  positions[0] = 0;
  positions[1] = 0;
  positions[2] = 0;
  uvs[0] = 0.5;
  uvs[1] = 0.5;

  let vertex = 1;
  for (let ring = 1; ring <= RADIAL_RINGS; ring += 1) {
    const radius = (DISK_RADIUS * ring) / RADIAL_RINGS;
    for (let sector = 0; sector < ANGULAR_SECTORS; sector += 1) {
      const angle = (TWO_PI * sector) / ANGULAR_SECTORS;
      const x = radius * Math.cos(angle);
      const z = radius * Math.sin(angle);
      const positionOffset = vertex * 3;
      const uvOffset = vertex * 2;
      positions[positionOffset] = x;
      positions[positionOffset + 1] = 0;
      positions[positionOffset + 2] = z;
      uvs[uvOffset] = x / (2 * DISK_RADIUS) + 0.5;
      uvs[uvOffset + 1] = z / (2 * DISK_RADIUS) + 0.5;
      vertex += 1;
    }
  }

  let indexOffset = 0;
  for (let sector = 0; sector < ANGULAR_SECTORS; sector += 1) {
    const current = 1 + sector;
    const next = 1 + ((sector + 1) % ANGULAR_SECTORS);
    indices[indexOffset] = 0;
    indices[indexOffset + 1] = next;
    indices[indexOffset + 2] = current;
    indexOffset += 3;
  }

  for (let ring = 1; ring < RADIAL_RINGS; ring += 1) {
    const innerStart = 1 + (ring - 1) * ANGULAR_SECTORS;
    const outerStart = innerStart + ANGULAR_SECTORS;
    for (let sector = 0; sector < ANGULAR_SECTORS; sector += 1) {
      const nextSector = (sector + 1) % ANGULAR_SECTORS;
      const inner = innerStart + sector;
      const innerNext = innerStart + nextSector;
      const outer = outerStart + sector;
      const outerNext = outerStart + nextSector;
      indices[indexOffset] = inner;
      indices[indexOffset + 1] = innerNext;
      indices[indexOffset + 2] = outer;
      indices[indexOffset + 3] = innerNext;
      indices[indexOffset + 4] = outerNext;
      indices[indexOffset + 5] = outer;
      indexOffset += 6;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.name = "retained-circular-membrane-disk";
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.setAttribute("shape", new THREE.BufferAttribute(new Float32Array(DISK_VERTEX_COUNT), 1));
  geometry.setAttribute("fx", new THREE.BufferAttribute(new Float32Array(DISK_VERTEX_COUNT), 1));
  geometry.setAttribute("fz", new THREE.BufferAttribute(new Float32Array(DISK_VERTEX_COUNT), 1));
  geometry.boundingBox = new THREE.Box3(
    new THREE.Vector3(-DISK_RADIUS, -MEMBRANE_AMPLITUDE, -DISK_RADIUS),
    new THREE.Vector3(DISK_RADIUS, MEMBRANE_AMPLITUDE, DISK_RADIUS)
  );
  geometry.boundingSphere = new THREE.Sphere(
    new THREE.Vector3(),
    Math.hypot(DISK_RADIUS, MEMBRANE_AMPLITUDE)
  );
  return geometry;
}

/** Compute mode attributes using one Bessel value and derivative per ring. */
export function createCircularModeAttributeData(mode: MembraneMode): CircularModeAttributeData {
  assertMode(mode);
  const shape = new Float32Array(DISK_VERTEX_COUNT);
  const fx = new Float32Array(DISK_VERTEX_COUNT);
  const fz = new Float32Array(DISK_VERTEX_COUNT);

  // Analytic centre limits. The axisymmetric family reaches +1 at the centre;
  // only m=1 has a finite non-zero Cartesian gradient there.
  if (mode.m === 0) {
    shape[0] = 1;
  } else if (mode.m === 1) {
    fx[0] = 2 * normalizedRadialDerivative(0, mode);
  }

  for (let ring = 1; ring <= RADIAL_RINGS; ring += 1) {
    const rho = ring / RADIAL_RINGS;
    const radial = ring === RADIAL_RINGS ? 0 : normalizedRadialMode(rho, mode);
    const radialDerivative = normalizedRadialDerivative(rho, mode);
    const inverseRho = 1 / rho;
    const ringStart = 1 + (ring - 1) * ANGULAR_SECTORS;

    for (let sector = 0; sector < ANGULAR_SECTORS; sector += 1) {
      const theta = (TWO_PI * sector) / ANGULAR_SECTORS;
      const cosTheta = Math.cos(theta);
      const sinTheta = Math.sin(theta);
      const cosModeTheta = Math.cos(mode.m * theta);
      const sinModeTheta = Math.sin(mode.m * theta);
      const dRho = radialDerivative * cosModeTheta;
      const dThetaOverRho = -mode.m * radial * sinModeTheta * inverseRho;
      const target = ringStart + sector;

      // The mathematical unit radius maps to geometry radius 0.5, hence the
      // factor two converting normalized-disk derivatives to world X/Z.
      shape[target] = radial * cosModeTheta;
      fx[target] = 2 * (dRho * cosTheta - dThetaOverRho * sinTheta);
      fz[target] = 2 * (dRho * sinTheta + dThetaOverRho * cosTheta);
    }
  }

  // Enforce the fixed boundary exactly, including gradients' angular term.
  const outerStart = 1 + (RADIAL_RINGS - 1) * ANGULAR_SECTORS;
  shape.fill(0, outerStart);
  return { shape, fx, fz };
}

export function updateCircularModeAttributes(
  geometry: THREE.BufferGeometry,
  mode: MembraneMode
): void {
  const data = createCircularModeAttributeData(mode);
  const shape = requireScalarAttribute(geometry, "shape");
  const fx = requireScalarAttribute(geometry, "fx");
  const fz = requireScalarAttribute(geometry, "fz");
  shape.array.set(data.shape);
  fx.array.set(data.fx);
  fz.array.set(data.fz);
  shape.needsUpdate = true;
  fx.needsUpdate = true;
  fz.needsUpdate = true;
}

function requireScalarAttribute(
  geometry: THREE.BufferGeometry,
  name: "shape" | "fx" | "fz"
): THREE.BufferAttribute & { array: Float32Array } {
  const attribute = geometry.getAttribute(name);
  if (!(attribute instanceof THREE.BufferAttribute) || !(attribute.array instanceof Float32Array)) {
    throw new TypeError(`Geometry requires a Float32 ${name} attribute.`);
  }
  return attribute as THREE.BufferAttribute & { array: Float32Array };
}

function createPerimeter(): PerimeterResources {
  const geometry = new THREE.TorusGeometry(DISK_RADIUS, 0.0045, 8, ANGULAR_SECTORS);
  const material = new THREE.MeshBasicMaterial({
    color: 0xdde8f5,
    toneMapped: false
  });
  const mesh = new THREE.Mesh(geometry, material);
  // TorusGeometry begins in XY; the membrane lies in XZ.
  mesh.rotation.x = Math.PI / 2;
  mesh.name = "fixed-boundary-perimeter";
  mesh.renderOrder = 2;
  return { mesh, geometry, material };
}

const MEMBRANE_VERTEX_SHADER = /* glsl */ `
  uniform float uAmplitude;
  uniform float uPhase;

  attribute float shape;
  attribute float fx;
  attribute float fz;

  varying vec2 vDisk;
  varying float vDisplacement;
  varying vec3 vViewNormal;

  void main() {
    float temporal = cos(uPhase);
    float displacement = shape * temporal;

    vec3 displaced = position;
    displaced.y = uAmplitude * displacement;

    float dydx = uAmplitude * temporal * fx;
    float dydz = uAmplitude * temporal * fz;
    vec3 objectNormal = normalize(vec3(-dydx, 1.0, -dydz));

    vDisk = position.xz / ${DISK_RADIUS.toFixed(1)};
    vDisplacement = displacement;
    vViewNormal = normalize(normalMatrix * objectNormal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
  }
`;

const MEMBRANE_FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D uBerlin;

  varying vec2 vDisk;
  varying float vDisplacement;
  varying vec3 vViewNormal;

  const float TWO_PI = 6.283185307179586;

  float wrappedAngleDelta(float delta) {
    float magnitude = abs(delta);
    return min(magnitude, TWO_PI - min(magnitude, TWO_PI));
  }

  float periodicLine(float phase, float phasePixelWidth) {
    // sin(phase) is a continuous signed zero-crossing field. Unlike a
    // fract/min distance it has no cusp whose derivatives can break at a
    // grazing camera angle.
    float field = sin(phase);
    float antialiasWidth = max(
      fwidth(field) * ${POLAR_GRID_LINE_WIDTH_PIXELS.toFixed(1)},
      0.00001
    );
    float coverage = 1.0 - smoothstep(0.0, antialiasWidth, abs(field));
    // Fade only when successive grid lines project too close to resolve. This
    // prevents moire-like dashes instead of allowing an undersampled pattern.
    float resolutionMask = 1.0 - smoothstep(0.9, 1.8, phasePixelWidth);
    return coverage * resolutionMask;
  }

  float polarGrid(float radius, float angle) {
    float ringPhase = 3.141592653589793 * ${POLAR_GRID_RING_DIVISIONS.toFixed(1)} * radius;
    float ringPhasePixelWidth =
      3.141592653589793 * ${POLAR_GRID_RING_DIVISIONS.toFixed(1)} * fwidth(radius);
    float ring = periodicLine(ringPhase, ringPhasePixelWidth);

    // sin(N theta / 2) has N zero rays around a complete revolution. Wrapped
    // angular derivatives avoid a false discontinuity at atan's branch cut.
    float spokeFrequency = ${POLAR_GRID_SPOKE_COUNT.toFixed(1)} * 0.5;
    float spokePhase = spokeFrequency * angle;
    float anglePixelWidth =
      wrappedAngleDelta(dFdx(angle)) + wrappedAngleDelta(dFdy(angle));
    float spoke = periodicLine(spokePhase, spokeFrequency * anglePixelWidth);
    float centerMask = smoothstep(0.025, 0.06, radius);
    float edgeMask = 1.0 - smoothstep(0.975, 0.997, radius);
    return max(ring, spoke) * centerMask * edgeMask;
  }

  void main() {
    float paletteCoordinate = clamp(vDisplacement * 0.5 + 0.5, 0.0, 1.0);
    // uBerlin is uploaded as an sRGB texture, so WebGL sampling has already
    // converted the published lookup-table values into the linear work space.
    vec3 baseColor = texture2D(uBerlin, vec2(paletteCoordinate, 0.5)).rgb;

    float radius = length(vDisk);
    float angle = atan(vDisk.y, vDisk.x);
    if (angle < 0.0) angle += TWO_PI;
    float grid = polarGrid(radius, angle);
    vec3 gridColor = sRGBTransferEOTF(vec4(0.52, 0.57, 0.63, 1.0)).rgb;
    // The neutral grid is part of the albedo, so it receives exactly the same
    // lighting as the membrane and never appears to float above the surface.
    vec3 surfaceColor = mix(baseColor, gridColor, grid * ${POLAR_GRID_OPACITY.toFixed(2)});

    vec3 normal = normalize(vViewNormal);
    if (!gl_FrontFacing) normal = -normal;
    float diffuse = 0.5 + 0.5 * max(0.0, dot(normal, normalize(vec3(0.28, 0.78, 0.56))));
    float surfaceLight = 0.88 + 0.12 * diffuse;
    surfaceColor *= surfaceLight;

    gl_FragColor = vec4(surfaceColor, 1.0);
    #include <colorspace_fragment>
  }
`;
