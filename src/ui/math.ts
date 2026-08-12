import katex from "katex";

export function renderMath(
  element: HTMLElement,
  tex: string,
  displayMode = false
): void {
  katex.render(tex, element, {
    displayMode,
    throwOnError: false,
    strict: false,
    trust: false,
    output: "htmlAndMathml"
  });
}

export function modeShapeTex(): string {
  return (
    `\\phi_{m,n}(r,\\theta)=` +
    `J_m\\!\\left(j_{m,n}r/R\\right)\\cos(m\\theta)`
  );
}
