/**
 * Server-side validation/normalization of model-generated specs. The model is
 * good but not perfect; this coerces its output into a well-formed UISpec and
 * rejects irrecoverable garbage so the client always receives something sane.
 *
 * Philosophy: repair what's safely repairable (missing ids, missing props
 * objects, non-array children), keep unknown component types (the client
 * renders a graceful placeholder), and throw only when the top-level shape is
 * unusable.
 */
import type { JSONValue, UINode, UISpec } from '../shared/spec.ts';

const KNOWN_TYPES = new Set([
  // layout
  'Stack', 'Row', 'Grid', 'Card', 'Tabs', 'Collapsible', 'Divider',
  // display
  'Heading', 'Text', 'Stat', 'Badge', 'List', 'KeyValue', 'ProgressBar', 'Gauge',
  // charts
  'BarChart', 'LineChart', 'PieChart',
  // input
  'Slider', 'NumberInput', 'TextInput', 'Toggle', 'Select', 'RadioGroup', 'ColorPicker', 'Swatch',
  // action + escape hatch
  'Button', 'CustomWidget',
]);

export interface ValidationResult {
  spec: UISpec;
  warnings: string[];
}

export function validateSpec(raw: unknown): ValidationResult {
  const warnings: string[] = [];

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Spec must be a JSON object with a "tree" array.');
  }
  const obj = raw as Record<string, unknown>;

  if (!Array.isArray(obj.tree)) {
    throw new Error('Spec.tree must be an array of nodes.');
  }

  let counter = 0;
  const nextId = (type: string) => `${type.toLowerCase()}-${counter++}`;

  const normNode = (input: unknown, path: string): UINode | null => {
    if (input === null || typeof input !== 'object' || Array.isArray(input)) {
      warnings.push(`Dropped non-object node at ${path}`);
      return null;
    }
    const n = input as Record<string, unknown>;
    const type = typeof n.type === 'string' ? n.type : '';
    if (!type) {
      warnings.push(`Dropped node missing "type" at ${path}`);
      return null;
    }
    if (!KNOWN_TYPES.has(type)) {
      warnings.push(`Unknown component type "${type}" at ${path} (kept; renders placeholder)`);
    }

    const id = typeof n.id === 'string' && n.id ? n.id : nextId(type);
    const props = isPlainObject(n.props) ? (n.props as Record<string, JSONValue>) : undefined;

    let bind: Record<string, string> | undefined;
    if (isPlainObject(n.bind)) {
      bind = {};
      for (const [k, v] of Object.entries(n.bind as Record<string, unknown>)) {
        if (typeof v === 'string') bind[k] = v;
        else warnings.push(`Dropped non-string bind "${k}" at ${path}`);
      }
    }

    let children: UINode[] | undefined;
    if (Array.isArray(n.children)) {
      children = n.children
        .map((c, i) => normNode(c, `${path}/children[${i}]`))
        .filter((c): c is UINode => c !== null);
    }

    return { id, type, ...(props ? { props } : {}), ...(bind ? { bind } : {}), ...(children ? { children } : {}) };
  };

  const tree = (obj.tree as unknown[])
    .map((node, i) => normNode(node, `tree[${i}]`))
    .filter((n): n is UINode => n !== null);

  if (tree.length === 0) {
    throw new Error('Spec produced no renderable nodes.');
  }

  const initialState = isPlainObject(obj.initialState)
    ? (obj.initialState as Record<string, JSONValue>)
    : undefined;

  return {
    spec: {
      ...(typeof obj.title === 'string' ? { title: obj.title } : {}),
      ...(initialState ? { initialState } : {}),
      tree,
    },
    warnings,
  };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
