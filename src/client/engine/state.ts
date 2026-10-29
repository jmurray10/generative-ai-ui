/**
 * The reactive state layer that turns a static spec into a working app.
 *
 * A generated UI shares one flat state map. Inputs write to it (by `stateKey`),
 * Buttons mutate it (via declarative actions), and display components read
 * computed values through `bind` expressions. Expressions are evaluated with
 * expr-eval's safe parser — never `eval`, never `new Function`.
 */
import { createContext, useContext } from 'react';
import { Parser } from 'expr-eval-fork';
import type { JSONValue, UIAction } from '../../shared/spec';

export type StateMap = Record<string, JSONValue>;

const parser = new Parser();

export interface GenStateApi {
  state: StateMap;
  setVar: (key: string, value: JSONValue) => void;
  dispatch: (action: UIAction) => void;
}

export const GenStateContext = createContext<GenStateApi | null>(null);

export function useGenState(): GenStateApi {
  const ctx = useContext(GenStateContext);
  if (!ctx) throw new Error('useGenState must be used within a GeneratedApp');
  return ctx;
}

/** Evaluate a bind expression against state. Returns undefined on any error. */
export function evalExpr(expr: string, state: StateMap): JSONValue | undefined {
  try {
    return parser.evaluate(expr, state as Record<string, number>) as JSONValue;
  } catch {
    return undefined;
  }
}

/** Pure reducer for declarative actions, used by the GeneratedApp provider. */
export function applyAction(
  state: StateMap,
  initialState: StateMap,
  action: UIAction,
): StateMap {
  switch (action.type) {
    case 'set':
      if (!action.key) return state;
      return { ...state, [action.key]: action.value ?? null };
    case 'increment': {
      if (!action.key) return state;
      const cur = typeof state[action.key] === 'number' ? (state[action.key] as number) : 0;
      const delta = typeof action.value === 'number' ? action.value : 1;
      return { ...state, [action.key]: cur + delta };
    }
    case 'toggle':
      if (!action.key) return state;
      return { ...state, [action.key]: !state[action.key] };
    case 'reset':
      return { ...initialState };
    default: {
      const unexpected: never = action.type;
      void unexpected;
      return state;
    }
  }
}
