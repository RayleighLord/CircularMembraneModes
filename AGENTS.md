# AGENTS.md

## Project purpose

This is a static, framework-free Vite application for exploring separated eigenmodes of the scalar
two-dimensional wave equation on a fixed circular membrane. It must remain usable without a
backend and deploy safely at a GitHub Pages repository subpath.

## Mathematical invariants

- The domain is `0 <= r <= R`, `theta` is periodic, and the Dirichlet boundary condition is
  `u(R,theta) = 0`.
- Allowed indices are integers `0 <= m <= 8` and `1 <= n <= 8`; the default is `(m,n) = (2,3)`.
- The displayed symbolic cosine representative is
  `phi = J_m(j_mn r/R) cos(m theta)`. The renderer peak-normalizes each mode internally so visible
  amplitudes are comparable, but normalization details stay out of the formula card.
- Do not show a symbolic or numerical frequency expression. `j_mn` is the `n`-th positive zero of
  `J_m` and has no closed form.
- Interior nodal circles are exactly `r/R = j_mk/j_mn`, `k=1,...,n-1`. Nodal diameters for `m>0`
  are exactly `theta=(2q+1)pi/(2m)`, `q=0,...,m-1`. Preserve this nodal metadata and its accessible
  description, derived from the spatial mode rather than the instantaneous animation phase. Visual
  nodal overlays are intentionally absent.
- For `m>0`, the sine partner is a rotated equivalent mode. The explorer deliberately fixes the
  cosine orientation and does not add an orientation control.
- Animation preserves the relative modal rate `omega_mn/omega_01 = j_mn/j_01`, with the fundamental
  `(m,n)=(0,1)` assigned a ten-second cycle. Do not present that calibration as a physical frequency
  without a membrane radius and wave speed.
- Color and height encode instantaneous signed displacement. The polar grid, labels, geometry, and
  accessible nodal description must keep the view understandable without color alone.

## Architecture

- Keep semantic HTML, DOM wiring, and lifecycle in `index.html` and `src/app.ts`.
- Keep accepted state and validation in `src/ui/controller.ts`.
- Keep pure Bessel functions, normalized mode functions, gradients, and nodal metadata in `src/math/`.
- Keep Three.js resources, phase, camera state, and animation scheduling in `src/membrane/`.
- Preserve Vite's relative `base: "./"` and the single test/build/deploy workflow.

## UX and verification

- The membrane is a full-viewport layer centered on the page. Desktop controls are overlays and must
  not reserve a layout column or shift the surface.
- Preserve visible KaTeX `m` and `n` labels and explicit values; never communicate selection through
  color alone.
- Keep both mode controls native, keyboard accessible, and at least 44 CSS pixels across their
  interactive axis.
- Preserve clean view, renderer fallback/retry, reduced-motion behavior, and keyboard camera controls.
- Run unit tests, typecheck, production build, browser smoke tests, and visual desktop/mobile
  inspection for interaction or layout changes. Run the browser benchmark for rendering-performance
  changes.
