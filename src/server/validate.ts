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
import type { JSONValue, UIAction, UINode, UISpec } from '../shared/spec.ts';

const EXPR_RESERVED = new Set([
  'min', 'max', 'abs', 'round', 'floor', 'ceil', 'sqrt', 'pow',
  'PI', 'E', 'true', 'false', 'if', 'and', 'or', 'not', 'in',
]);

const specNoticeMap = new WeakMap<UISpec, string[]>();

export function specNotices(spec: UISpec): string[] {
  return specNoticeMap.get(spec) ?? [];
}

const KNOWN_TYPES = new Set([
  // layout
  'Stack', 'Row', 'Grid', 'Card', 'Tabs', 'Collapsible', 'Divider',
  // display
  'Heading', 'Text', 'Stat', 'Badge', 'List', 'KeyValue', 'ProgressBar', 'Gauge',
  // charts
  'BarChart', 'LineChart', 'PieChart',
  // input
  'Slider', 'NumberInput', 'TextInput', 'Toggle', 'Select', 'RadioGroup', 'ColorPicker', 'Swatch',
  // action + sandboxed escape hatches
  'Button', 'CustomWidget', 'ReactArtifact',
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

  const seeded = isPlainObject(obj.initialState)
    ? { ...(obj.initialState as Record<string, JSONValue>) }
    : {};
  const filled = fillMissingState(tree, seeded, warnings);
  const theme = isPlainObject(obj.theme) ? (obj.theme as UISpec['theme']) : undefined;

  const spec: UISpec = {
    ...(typeof obj.title === 'string' ? { title: obj.title } : {}),
    ...(Object.keys(filled).length ? { initialState: filled } : {}),
    ...(theme ? { theme } : {}),
    tree,
  };
  specNoticeMap.set(spec, warnings);
  return { spec, warnings };
}

function fillMissingState(tree: UINode[], state: Record<string, JSONValue>, warnings: string[]): Record<string, JSONValue> {
  const needed = new Map<string, JSONValue>();
  const remember = (key: string, value: JSONValue) => {
    if (!key || EXPR_RESERVED.has(key) || key in state || needed.has(key)) return;
    needed.set(key, value);
  };
  const walk = (node: UINode) => {
    const props = node.props ?? {};
    if (typeof props.stateKey === 'string') remember(props.stateKey, defaultFor(node.type, props));
    const action = props.action;
    if (action && typeof action === 'object' && !Array.isArray(action) && typeof (action as UIAction).key === 'string') {
      remember((action as UIAction).key as string, 0);
    }
    if (node.bind) {
      for (const expr of Object.values(node.bind)) {
        for (const id of identifiers(expr)) remember(id, 0);
      }
    }
    (node.children ?? []).forEach(walk);
  };
  tree.forEach(walk);
  if (needed.size === 0) return state;
  const keys = [...needed.keys()];
  warnings.push(`Filled missing initialState for ${keys.join(', ')}.`);
  for (const [key, value] of needed) state[key] = value;
  return state;
}

function defaultFor(type: string, props: Record<string, JSONValue | UIAction>): JSONValue {
  switch (type) {
    case 'Toggle':
      return false;
    case 'TextInput':
      return '';
    case 'ColorPicker':
      return '#7c5cff';
    case 'Select':
    case 'RadioGroup': {
      const options = props.options;
      if (Array.isArray(options)) {
        const first = options[0];
        if (first && typeof first === 'object' && !Array.isArray(first) && 'value' in first) {
          return (first as { value: JSONValue }).value;
        }
      }
      return '';
    }
    case 'Slider':
    case 'NumberInput':
      return typeof props.min === 'number' ? props.min : 0;
    default:
      return 0;
  }
}

function identifiers(expr: string): string[] {
  return [...expr.matchAll(/\b[A-Za-z_][A-Za-z0-9_]*\b/g)].map((match) => match[0]);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
