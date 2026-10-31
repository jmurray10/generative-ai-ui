/**
 * Intake wizard state. One reducer owns every step so values, confirmations
 * and the audit trail carry across Back/Next without re-extracting.
 */
import { FIELDS, flagFor, provisionalResult, validateField, type Extraction, type FieldId } from '../../shared/intake';

export const STEPS = ['Source', 'Fix gaps', 'Review', 'Decision'] as const;
export type Step = 0 | 1 | 2 | 3;

export interface AuditEntry { at: string; what: string }

export interface IntakeState {
  step: Step;
  text: string;
  sampleId: string | null;
  status: 'idle' | 'extracting' | 'error';
  error: string | null;
  extraction: Extraction | null;
  values: Partial<Record<FieldId, string>>;
  confirmed: Partial<Record<FieldId, boolean>>;
  edited: Partial<Record<FieldId, boolean>>;
  outcome: null | { kind: 'approved' | 'sent_back'; note: string };
  audit: AuditEntry[];
}

export type IntakeAction =
  | { type: 'text'; text: string; sampleId?: string | null }
  | { type: 'extract_start' }
  | { type: 'extract_ok'; extraction: Extraction }
  | { type: 'extract_fail'; error: string }
  | { type: 'edit'; id: FieldId; value: string }
  | { type: 'confirm'; id: FieldId; value: boolean }
  | { type: 'goto'; step: Step }
  | { type: 'decide'; kind: 'approved' | 'sent_back'; note: string }
  | { type: 'reset' };

export const initialIntake: IntakeState = {
  step: 0, text: '', sampleId: null, status: 'idle', error: null, extraction: null,
  values: {}, confirmed: {}, edited: {}, outcome: null, audit: [],
};

const stamp = (what: string, now = new Date()): AuditEntry => ({ at: now.toISOString(), what });

/** Fields still blocking step 2: invalid values, or "check" fields neither confirmed nor edited. */
export function blockers(s: IntakeState): { id: FieldId; why: string }[] {
  const out: { id: FieldId; why: string }[] = [];
  for (const def of FIELDS) {
    const invalid = validateField(def, s.values[def.id]);
    if (invalid) { out.push({ id: def.id, why: invalid }); continue; }
    const flag = flagFor(s.extraction?.[def.id]);
    if (flag !== 'confident' && !s.confirmed[def.id] && !s.edited[def.id]) out.push({ id: def.id, why: 'Check this value and confirm it.' });
  }
  return out;
}

export function canGo(s: IntakeState, step: Step): boolean {
  if (step === 0) return true;
  if (!s.extraction) return false;
  if (step === 1) return true;
  return blockers(s).length === 0;
}

export function intakeReducer(s: IntakeState, a: IntakeAction): IntakeState {
  switch (a.type) {
    case 'text':
      return { ...s, text: a.text, sampleId: a.sampleId ?? null };
    case 'extract_start':
      return { ...s, status: 'extracting', error: null };
    case 'extract_ok': {
      const values = Object.fromEntries(FIELDS.map((f) => [f.id, a.extraction[f.id]?.value ?? ''])) as Partial<Record<FieldId, string>>;
      return { ...s, status: 'idle', extraction: a.extraction, values, confirmed: {}, edited: {}, outcome: null, step: 1, audit: [...s.audit, stamp('Grok extracted the fields')] };
    }
    case 'extract_fail':
      return { ...s, status: 'error', error: a.error };
    case 'edit': {
      const was = s.values[a.id] ?? '';
      if (was === a.value) return s;
      const fromModel = s.extraction?.[a.id]?.value ?? '';
      return { ...s, values: { ...s.values, [a.id]: a.value }, edited: { ...s.edited, [a.id]: a.value !== fromModel } };
    }
    case 'confirm':
      return { ...s, confirmed: { ...s.confirmed, [a.id]: a.value } };
    case 'goto': {
      if (!canGo(s, a.step)) return s;
      // Leaving step 1 records what the reviewer confirmed. Going Back and Next again with the
      // same values adds nothing; a revisit that changes the edits adds one new line.
      let audit = s.audit;
      if (s.step === 1 && a.step > 1) {
        const editedLabels = FIELDS.filter((f) => s.edited[f.id]).map((f) => f.label);
        const what = `Reviewer confirmed the fields${editedLabels.length ? ` and edited ${editedLabels.join(', ')}` : ''}`;
        const last = [...s.audit].reverse().find((e) => e.what.startsWith('Reviewer confirmed'));
        if (last?.what !== what) audit = [...s.audit, stamp(what)];
      }
      return { ...s, step: a.step, audit };
    }
    case 'decide':
      if (s.step !== 3 || blockers(s).length) return s;
      if (a.kind === 'sent_back' && !a.note.trim()) return s;
      if (a.kind === 'approved' && !provisionalResult(s.values).ready) return s;
      return { ...s, outcome: { kind: a.kind, note: a.note.trim() }, audit: [...s.audit, stamp(a.kind === 'approved' ? 'Approved' : `Sent back: ${a.note.trim()}`)] };
    case 'reset':
      return initialIntake;
  }
}
