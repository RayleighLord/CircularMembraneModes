import { readFileSync } from "node:fs";

import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { cartesianGradient, createModeSelection, spatialMode } from "../math";
import {
  ANGULAR_SECTORS,
  DISK_RADIUS,
  DISK_TRIANGLE_COUNT,
  DISK_VERTEX_COUNT,
  POLAR_GRID_LINE_WIDTH_PIXELS,
  POLAR_GRID_OPACITY,
  POLAR_GRID_RING_DIVISIONS,
  POLAR_GRID_SPOKE_COUNT,
  RADIAL_RINGS,
  createCircularDiskGeometry,
  createCircularModeAttributeData,
  updateCircularModeAttributes
} from "../membrane";

describe("retained circular membrane geometry", () => {
  it("has the planned indexed topology without a duplicated angular seam", () => {
    const geometry = createCircularDiskGeometry();
    const positions = geometry.getAttribute("position");
    const index = geometry.getIndex();

    expect(positions.count).toBe(32_769);
    expect(positions.count).toBe(DISK_VERTEX_COUNT);
    expect(index?.count).toBe(65_280 * 3);
    expect((index?.array as Uint16Array).constructor).toBe(Uint16Array);
    expect(DISK_TRIANGLE_COUNT).toBe(65_280);
    expect(RADIAL_RINGS).toBe(128);
    expect(ANGULAR_SECTORS).toBe(256);

    // Each non-centre radius occurs exactly once per angular sector. There is
    // no theta=2pi duplicate sharing the theta=0 position.
    expect((positions.count - 1) / RADIAL_RINGS).toBe(ANGULAR_SECTORS);
    const firstRingStart = 1;
    const firstRingEnd = firstRingStart + ANGULAR_SECTORS - 1;
    expect(positions.getX(firstRingStart)).toBeCloseTo(DISK_RADIUS / RADIAL_RINGS, 8);
    expect(positions.getZ(firstRingStart)).toBeCloseTo(0, 8);
    expect(positions.getZ(firstRingEnd)).not.toBeCloseTo(0, 8);
    geometry.dispose();
  });

  it("winds every triangle toward positive Y and closes every ring", () => {
    const geometry = createCircularDiskGeometry();
    const positions = geometry.getAttribute("position");
    const index = geometry.getIndex();
    expect(index).not.toBeNull();

    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const cross = new THREE.Vector3();
    for (let offset = 0; offset < index!.count; offset += 3) {
      a.fromBufferAttribute(positions, index!.getX(offset));
      b.fromBufferAttribute(positions, index!.getX(offset + 1));
      c.fromBufferAttribute(positions, index!.getX(offset + 2));
      cross.subVectors(b, a).cross(c.clone().sub(a));
      expect(cross.y).toBeGreaterThan(0);
    }

    const values = index!.array;
    expect([...values.slice(0, 3)]).toEqual([0, 2, 1]);
    expect([...values.slice((ANGULAR_SECTORS - 1) * 3, ANGULAR_SECTORS * 3)]).toEqual([
      0,
      1,
      ANGULAR_SECTORS
    ]);
    geometry.dispose();
  });

  it("computes finite normalized shape and analytic world-space gradients", () => {
    const representativeModes = [
      createModeSelection(0, 1),
      createModeSelection(1, 1),
      createModeSelection(2, 3),
      createModeSelection(8, 8)
    ];

    for (const mode of representativeModes) {
      const data = createCircularModeAttributeData(mode);
      expect(data.shape).toHaveLength(DISK_VERTEX_COUNT);
      expect(data.fx).toHaveLength(DISK_VERTEX_COUNT);
      expect(data.fz).toHaveLength(DISK_VERTEX_COUNT);
      expect([...data.shape, ...data.fx, ...data.fz].every(Number.isFinite)).toBe(true);

      const outerStart = 1 + (RADIAL_RINGS - 1) * ANGULAR_SECTORS;
      expect(data.shape.slice(outerStart).every((value) => Object.is(value, 0))).toBe(true);

      const ring = 53;
      const sector = 37;
      const rho = ring / RADIAL_RINGS;
      const theta = (2 * Math.PI * sector) / ANGULAR_SECTORS;
      const unitX = rho * Math.cos(theta);
      const unitY = rho * Math.sin(theta);
      const vertex = 1 + (ring - 1) * ANGULAR_SECTORS + sector;
      const gradient = cartesianGradient(unitX, unitY, mode);
      expect(data.shape[vertex]).toBeCloseTo(spatialMode(rho, theta, mode), 5);
      expect(data.fx[vertex]).toBeCloseTo(2 * gradient.dx, 4);
      expect(data.fz[vertex]).toBeCloseTo(2 * gradient.dy, 4);
    }
  });

  it("updates existing attributes instead of replacing retained buffers", () => {
    const geometry = createCircularDiskGeometry();
    const shape = geometry.getAttribute("shape") as THREE.BufferAttribute;
    const fx = geometry.getAttribute("fx");
    const fz = geometry.getAttribute("fz");
    const position = geometry.getAttribute("position");
    const index = geometry.getIndex();

    updateCircularModeAttributes(geometry, createModeSelection(2, 3));
    expect(geometry.getAttribute("shape")).toBe(shape);
    expect(geometry.getAttribute("fx")).toBe(fx);
    expect(geometry.getAttribute("fz")).toBe(fz);
    expect(geometry.getAttribute("position")).toBe(position);
    expect(geometry.getIndex()).toBe(index);
    expect(shape.version).toBeGreaterThan(0);
    geometry.dispose();
  });

  it("uses the analytic centre limits for m=0, m=1, and higher orders", () => {
    const axisymmetric = createCircularModeAttributeData(createModeSelection(0, 5));
    expect(axisymmetric.shape[0]).toBe(1);
    expect(axisymmetric.fx[0]).toBe(0);
    expect(axisymmetric.fz[0]).toBe(0);

    const dipole = createCircularModeAttributeData(createModeSelection(1, 3));
    expect(dipole.shape[0]).toBe(0);
    expect(dipole.fx[0]).toBeGreaterThan(0);
    expect(dipole.fz[0]).toBe(0);

    const higherOrder = createCircularModeAttributeData(createModeSelection(8, 8));
    expect(higherOrder.shape[0]).toBe(0);
    expect(higherOrder.fx[0]).toBe(0);
    expect(higherOrder.fz[0]).toBe(0);
  });

  it("produces valid animated normals, including a flat quarter-cycle phase", () => {
    const data = createCircularModeAttributeData(createModeSelection(8, 8));
    const phases = [0, Math.PI / 2, Math.PI];
    for (const phase of phases) {
      const temporal = Math.cos(phase);
      for (let index = 0; index < DISK_VERTEX_COUNT; index += 211) {
        const normal = new THREE.Vector3(
          -0.09 * temporal * data.fx[index]!,
          1,
          -0.09 * temporal * data.fz[index]!
        ).normalize();
        expect(normal.toArray().every(Number.isFinite)).toBe(true);
        expect(normal.length()).toBeCloseTo(1, 12);
        if (phase === Math.PI / 2) {
          expect(normal.x).toBeCloseTo(0, 12);
          expect(normal.y).toBeCloseTo(1, 12);
          expect(normal.z).toBeCloseTo(0, 12);
        }
      }
    }
  });

  it("keeps a thin continuous same-surface polar grid", () => {
    expect(POLAR_GRID_RING_DIVISIONS).toBe(16);
    expect(POLAR_GRID_SPOKE_COUNT).toBe(32);
    expect(POLAR_GRID_LINE_WIDTH_PIXELS).toBe(1);
    expect(POLAR_GRID_OPACITY).toBeLessThanOrEqual(0.32);

    const rendererSource = readFileSync("src/membrane/renderer.ts", "utf8");
    expect(rendererSource).toContain("float field = sin(phase);");
    expect(rendererSource).toContain("return max(ring, spoke) * centerMask * edgeMask;");
    expect(rendererSource).not.toContain("min(fract(ringCoordinate)");
    expect(rendererSource).not.toContain("baseLuminance <");

    const albedoBlend = rendererSource.indexOf("vec3 surfaceColor = mix(baseColor, gridColor");
    const surfaceLighting = rendererSource.indexOf("surfaceColor *= surfaceLight;");
    expect(albedoBlend).toBeGreaterThan(-1);
    expect(surfaceLighting).toBeGreaterThan(albedoBlend);
  });
});
