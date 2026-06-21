/**
 * The generative-UI spec format — shared by the server (which produces specs)
 * and the client engine (which renders them).
 *
 * A spec is a small, declarative description of an interface. The LLM (or the
 * offline stub) emits one of these; the client renders it with a whitelisted
 * component registry plus a reactive state layer. No model-authored code runs
 * in the safe lane — the only place arbitrary code executes is the sandboxed
 * `CustomWidget` (iframe with `sandbox="allow-scripts"`, no same-origin).
 */

export type JSONValue =
  | string
  | number
  | boolean
  | null
  | JSONValue[]
  | { [key: string]: JSONValue };

/** A declarative state mutation a Button (or other action source) can dispatch. */
export interface UIAction {
  /** set: assign value to key. increment: add numeric value to key.
   *  toggle: boolean-flip key. reset: restore initialState. */
  type: 'set' | 'increment' | 'toggle' | 'reset';
  key?: string;
  value?: JSONValue;
}

/** A single node in the UI tree. */
export interface UINode {
  id: string;
  /** Registry component name, e.g. "Card", "Slider", "Stat", "CustomWidget". */
  type: string;
  /** Static props passed straight to the component. */
  props?: Record<string, JSONValue | UIAction>;
  /**
   * Reactive bindings: prop name -> expression evaluated against the live
   * state on every render (safe parser, never `eval`). Overrides `props`.
   */
  bind?: Record<string, string>;
  children?: UINode[];
}

/** The full generated interface. */
export interface UISpec {
  title?: string;
  /** Seed values for the reactive store. */
  initialState?: Record<string, JSONValue>;
  tree: UINode[];
}

/** A gallery/example entry: a named prompt with its canned spec. */
export interface Example {
  id: string;
  title: string;
  prompt: string;
  blurb: string;
  spec: UISpec;
}

/** Response shape of POST /api/generate. */
export interface GenerateResponse {
  prompt: string;
  source: 'stub' | 'gemini';
  spec: UISpec;
}
