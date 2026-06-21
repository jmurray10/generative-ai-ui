/**
 * Renders a UISpec into live React. Owns the reactive store for one generation
 * and resolves `bind` expressions per node on every render. Unknown component
 * types degrade gracefully instead of crashing the tree.
 */
import React, { useMemo, useState } from 'react';
import type { JSONValue, UIAction, UINode, UISpec } from '../../shared/spec';
import { registry } from './components';
import { GenStateContext, evalExpr, applyAction, type StateMap } from './state';

function Unknown({ type }: { type: string }) {
  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
      Unknown component: <code>{type}</code>
    </div>
  );
}

const Node: React.FC<{ node: UINode; state: StateMap }> = ({ node, state }) => {
  const Comp = registry[node.type];
  const children = node.children?.map((c) => <Node key={c.id} node={c} state={state} />);
  if (!Comp) return <Unknown type={node.type} />;

  const bound: Record<string, unknown> = {};
  if (node.bind) {
    for (const [prop, expr] of Object.entries(node.bind)) bound[prop] = evalExpr(expr, state);
  }
  return (
    <Comp {...(node.props as object)} {...bound}>
      {children}
    </Comp>
  );
};

export const GeneratedApp: React.FC<{ spec: UISpec }> = ({ spec }) => {
  // Depend on initialState identity (not the whole spec) so streaming new nodes
  // into spec.tree doesn't churn the seed on every frame.
  const initialState = useMemo<StateMap>(() => ({ ...(spec.initialState ?? {}) }), [spec.initialState]);
  const [state, setState] = useState<StateMap>(initialState);

  const api = useMemo(
    () => ({
      state,
      setVar: (key: string, value: JSONValue) => setState((s) => ({ ...s, [key]: value })),
      dispatch: (action: UIAction) => setState((s) => applyAction(s, initialState, action)),
    }),
    [state, initialState],
  );

  return (
    <GenStateContext.Provider value={api}>
      <div className="flex flex-col gap-4">
        {spec.tree.map((node) => (
          <div key={node.id} className="animate-rise">
            <Node node={node} state={state} />
          </div>
        ))}
      </div>
    </GenStateContext.Provider>
  );
};
