import katex from "katex";

import type { ModeAxis, ModeSelection } from "../types";

export type { ModeAxis, ModeSelection } from "../types";

export const MIN_AZIMUTHAL_MODE_NUMBER = 0;
export const MIN_RADIAL_MODE_NUMBER = 1;
export const MAX_MODE_NUMBER = 8;

export type ModeNumbers = ModeSelection;
export type ModeNumber = ModeSelection[ModeAxis];

export interface ModeSelectorChange {
  axis: ModeAxis;
  value: ModeNumber;
  values: ModeNumbers;
}

export interface ModeSelectorsOptions {
  initialValues?: Partial<ModeNumbers>;
  onChange?: (change: ModeSelectorChange) => void;
  onInput?: (change: ModeSelectorChange) => void;
  onCommit?: (change: ModeSelectorChange) => void;
}

type SelectorElements = {
  input: HTMLInputElement;
  value: HTMLElement;
};

const AXES: readonly ModeAxis[] = ["m", "n"];

/**
 * Semantic, controlled mode-number inputs. The application owns accepted
 * state; setValues() is the only programmatic state update surface.
 */
export class ModeSelectors {
  readonly root: HTMLElement;

  private readonly options: ModeSelectorsOptions;
  private readonly selectors: Record<ModeAxis, SelectorElements>;
  private readonly cleanup: Array<() => void> = [];
  private destroyed = false;

  constructor(host: HTMLElement, options: ModeSelectorsOptions = {}) {
    this.root = host;
    this.options = options;
    this.root.classList.add("mode-selectors");
    this.root.setAttribute("role", "group");
    this.root.setAttribute("aria-label", "Choose the azimuthal and radial mode numbers");

    const initialValues: ModeNumbers = {
      m: normalizeModeNumber("m", options.initialValues?.m ?? 2) as ModeSelection["m"],
      n: normalizeModeNumber("n", options.initialValues?.n ?? 3) as ModeSelection["n"]
    };

    this.selectors = {
      m: this.createSelector("m", initialValues.m),
      n: this.createSelector("n", initialValues.n)
    };
    this.root.replaceChildren(
      this.selectors.m.input.closest(".mode-selector") as HTMLElement,
      this.selectors.n.input.closest(".mode-selector") as HTMLElement
    );

    for (const axis of AXES) {
      this.bindSelector(axis);
    }
    this.setValues(initialValues);
  }

  setValues(values: Readonly<ModeNumbers>): void {
    this.assertActive();
    this.updateSelector("m", normalizeModeNumber("m", values.m));
    this.updateSelector("n", normalizeModeNumber("n", values.n));
  }

  getValues(): ModeNumbers {
    this.assertActive();
    return this.readValues();
  }

  setDisabled(disabled: boolean): void {
    this.assertActive();
    for (const axis of AXES) {
      this.selectors[axis].input.disabled = disabled;
    }
    this.root.setAttribute("aria-disabled", String(disabled));
  }

  focus(axis: ModeAxis): void {
    this.assertActive();
    this.selectors[axis].input.focus();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const dispose of this.cleanup.splice(0)) {
      dispose();
    }
    this.root.replaceChildren();
    this.root.classList.remove("mode-selectors");
    this.root.removeAttribute("role");
    this.root.removeAttribute("aria-label");
    this.root.removeAttribute("aria-disabled");
  }

  private createSelector(axis: ModeAxis, initialValue: number): SelectorElements {
    const field = document.createElement("section");
    field.className = "mode-selector";
    field.dataset.axis = axis;

    const heading = document.createElement("div");
    heading.className = "mode-selector__heading";

    const label = document.createElement("label");
    label.className = "mode-selector__label";
    label.htmlFor = `${axis}-slider`;
    renderMath(label, axis);

    const value = document.createElement("output");
    value.id = `${axis}-value-math`;
    value.className = "mode-selector__value";
    value.htmlFor = `${axis}-slider`;
    value.setAttribute("aria-hidden", "true");
    heading.append(label, value);

    const sliderFrame = document.createElement("div");
    sliderFrame.className = "mode-selector__slider-frame";

    const ticks = document.createElement("div");
    ticks.className = "mode-selector__ticks";
    ticks.setAttribute("aria-hidden", "true");
    for (let tick = MAX_MODE_NUMBER; tick >= minimumForAxis(axis); tick -= 1) {
      const mark = document.createElement("span");
      mark.className = "mode-selector__tick";
      mark.textContent = String(tick);
      ticks.append(mark);
    }

    const input = document.createElement("input");
    input.id = `${axis}-slider`;
    input.className = "mode-selector__range";
    input.type = "range";
    input.min = String(minimumForAxis(axis));
    input.max = String(MAX_MODE_NUMBER);
    input.step = "1";
    input.value = String(initialValue);
    input.setAttribute("orient", "vertical");
    input.setAttribute(
      "aria-label",
      axis === "m" ? "Azimuthal mode number m" : "Radial mode number n"
    );
    input.setAttribute("aria-valuetext", String(initialValue));
    sliderFrame.append(ticks, input);

    field.append(heading, sliderFrame);
    return { input, value };
  }

  private bindSelector(axis: ModeAxis): void {
    const input = this.selectors[axis].input;
    const handleInput = (): void => {
      const value = normalizeModeNumber(axis, Number(input.value));
      this.updateSelector(axis, value);
      const change = this.makeChange(axis, value);
      this.options.onChange?.(change);
      this.options.onInput?.(change);
    };
    const handleChange = (): void => {
      const value = normalizeModeNumber(axis, Number(input.value));
      this.updateSelector(axis, value);
      this.options.onCommit?.(this.makeChange(axis, value));
    };

    input.addEventListener("input", handleInput);
    input.addEventListener("change", handleChange);
    this.cleanup.push(
      () => input.removeEventListener("input", handleInput),
      () => input.removeEventListener("change", handleChange)
    );
  }

  private makeChange(axis: ModeAxis, value: ModeNumber): ModeSelectorChange {
    return { axis, value, values: this.readValues() };
  }

  private readValues(): ModeNumbers {
    return {
      m: normalizeModeNumber("m", Number(this.selectors.m.input.value)) as ModeSelection["m"],
      n: normalizeModeNumber("n", Number(this.selectors.n.input.value)) as ModeSelection["n"]
    };
  }

  private updateSelector(axis: ModeAxis, value: ModeNumber): void {
    const selector = this.selectors[axis];
    selector.input.value = String(value);
    selector.input.setAttribute("aria-valuetext", String(value));
    const minimum = minimumForAxis(axis);
    const progress = (value - minimum) / (MAX_MODE_NUMBER - minimum);
    selector.input.style.setProperty("--mode-progress", `${progress * 100}%`);
    renderMath(selector.value, `${axis}=${value}`);
  }

  private assertActive(): void {
    if (this.destroyed) {
      throw new Error("ModeSelectors has been destroyed.");
    }
  }
}

export function isValidModeNumber(axis: ModeAxis, value: number): value is ModeNumber {
  return Number.isInteger(value) && value >= minimumForAxis(axis) && value <= MAX_MODE_NUMBER;
}

function normalizeModeNumber(axis: ModeAxis, value: number): ModeNumber {
  if (!isValidModeNumber(axis, value)) {
    throw new RangeError(
      `${axis} must be an integer from ${minimumForAxis(axis)} through ${MAX_MODE_NUMBER}; received ${value}.`
    );
  }
  return value;
}

function minimumForAxis(axis: ModeAxis): number {
  return axis === "m" ? MIN_AZIMUTHAL_MODE_NUMBER : MIN_RADIAL_MODE_NUMBER;
}

function renderMath(element: HTMLElement, tex: string): void {
  katex.render(tex, element, {
    displayMode: false,
    throwOnError: false,
    strict: false,
    trust: false
  });
}
