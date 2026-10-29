/** Values voice should read from form controls. innerText does not include them. */

export interface ControlSnap {
  type: string;
  name: string;
  value: string;
  checked?: boolean;
}

export function digestControls(controls: ControlSnap[]): string {
  const bits: string[] = [];
  for (const el of controls) {
    const type = el.type.toLowerCase();
    if (type === 'hidden' || type === 'button' || type === 'submit' || type === 'range' || type === 'file') continue;
    if (type === 'checkbox') {
      bits.push(`${el.name}: ${el.checked ? 'on' : 'off'}`);
      continue;
    }
    if (type === 'radio') {
      if (el.checked) bits.push(`${el.name}: ${el.value || 'on'}`);
      continue;
    }
    if (el.value !== '') bits.push(`${el.name}: ${el.value}`);
  }
  return bits.join(' · ');
}

export function digestDomControls(root: ParentNode): string {
  const controls: ControlSnap[] = [];
  root.querySelectorAll('input, textarea, select').forEach((node, index) => {
    if (node instanceof HTMLInputElement) {
      controls.push({
        type: node.type,
        name: node.getAttribute('aria-label') || node.name || node.placeholder || `field ${index + 1}`,
        value: node.value,
        checked: node.checked,
      });
      return;
    }
    if (node instanceof HTMLTextAreaElement || node instanceof HTMLSelectElement) {
      controls.push({
        type: node instanceof HTMLSelectElement ? 'select' : 'textarea',
        name: node.getAttribute('aria-label') || node.getAttribute('name') || `field ${index + 1}`,
        value: node.value,
      });
    }
  });
  return digestControls(controls);
}
