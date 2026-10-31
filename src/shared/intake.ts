/**
 * Showcase D: a vendor-onboarding intake. Fields, validation and the
 * provisional result are deterministic code; Grok only extracts values and
 * says how sure it is. All sample text is synthetic.
 */

export type FieldId = 'legal_name' | 'contact_email' | 'tax_id' | 'country' | 'annual_spend_usd' | 'payment_terms_days' | 'handles_personal_data' | 'start_date';

export interface FieldDef { id: FieldId; label: string; kind: 'text' | 'email' | 'number' | 'yesno' | 'date'; required: boolean; hint: string }

export const FIELDS: FieldDef[] = [
  { id: 'legal_name', label: 'Legal name', kind: 'text', required: true, hint: 'Registered company name' },
  { id: 'contact_email', label: 'Contact email', kind: 'email', required: true, hint: 'name@company.com' },
  { id: 'tax_id', label: 'Tax ID', kind: 'text', required: true, hint: 'Format XX-1234567' },
  { id: 'country', label: 'Country', kind: 'text', required: true, hint: 'Where the vendor is registered' },
  { id: 'annual_spend_usd', label: 'Expected annual spend (USD)', kind: 'number', required: true, hint: 'Whole dollars' },
  { id: 'payment_terms_days', label: 'Payment terms (days)', kind: 'number', required: true, hint: 'e.g. 30' },
  { id: 'handles_personal_data', label: 'Handles personal data', kind: 'yesno', required: true, hint: 'yes or no' },
  { id: 'start_date', label: 'Start date', kind: 'date', required: true, hint: 'YYYY-MM-DD' },
];

export interface ExtractedField { value: string | null; confidence: number; quote: string | null; quoteFound: boolean }
export type Extraction = Record<FieldId, ExtractedField>;

export type Flag = 'confident' | 'check' | 'missing';

export const CONFIDENT_AT = 0.8;

/** A field is confident only when the model is sure AND its quote is really in the source. */
export function flagFor(f: ExtractedField | undefined): Flag {
  if (!f || f.value === null || f.value === '') return 'missing';
  if (f.confidence >= CONFIDENT_AT && f.quoteFound) return 'confident';
  return 'check';
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
export function quoteInSource(source: string, quote: string | null): boolean {
  if (!quote || quote.trim().length < 3) return false;
  return norm(source).includes(norm(quote));
}

export function validateField(def: FieldDef, value: string | null | undefined): string | null {
  const v = (value ?? '').trim();
  if (!v) return def.required ? `${def.label} is required.` : null;
  switch (def.kind) {
    case 'email':
      return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(v) ? null : 'Enter an email like name@company.com.';
    case 'number':
      return /^\d+(\.\d+)?$/.test(v.replace(/[,$]/g, '')) ? null : 'Enter a number.';
    case 'yesno':
      return /^(yes|no)$/i.test(v) ? null : 'Enter yes or no.';
    case 'date':
      return /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? null : 'Use YYYY-MM-DD.';
    default:
      if (def.id === 'tax_id' && !/^\d{2}-\d{7}$/.test(v)) return 'Use the format 12-3456789.';
      return null;
  }
}

export interface ProvisionalResult {
  tier: 'standard' | 'enhanced';
  reasons: string[];
  checks: { label: string; ok: boolean }[];
  ready: boolean;
}

const toNumber = (v: string | undefined) => Number(String(v ?? '').replace(/[,$]/g, ''));

/** Deterministic, so the same values always give the same provisional result. */
export function provisionalResult(values: Partial<Record<FieldId, string>>, today = new Date()): ProvisionalResult {
  const reasons: string[] = [];
  const spend = toNumber(values.annual_spend_usd);
  const personal = /^yes$/i.test(values.handles_personal_data ?? '');
  if (spend >= 100_000) reasons.push(`Annual spend of $${spend.toLocaleString('en-US')} is at or above $100,000.`);
  if (personal) reasons.push('The vendor will handle personal data.');
  if (toNumber(values.payment_terms_days) < 30) reasons.push('Payment terms are shorter than 30 days.');
  const start = Date.parse(values.start_date ?? '');
  const checks = [
    ...FIELDS.map((d) => ({ label: `${d.label} is valid`, ok: validateField(d, values[d.id]) === null })),
    { label: 'Start date is today or later', ok: Number.isFinite(start) && start >= Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) },
  ];
  return { tier: reasons.length ? 'enhanced' : 'standard', reasons, checks, ready: checks.every((c) => c.ok) };
}

export const INTAKE_SAMPLES: { id: string; title: string; text: string }[] = [
  {
    id: 'sample-complete',
    title: 'Email from a catering vendor',
    text: `Subject: New vendor setup - Fernhill Catering

Hi procurement team,

We'd like to set up Fernhill Catering Ltd. as a vendor for the spring offsite program.
Main contact is Jules Moreau (jules.moreau@fernhillcatering.example).
Our tax ID is 47-2958316 and we're registered in Canada.
We expect roughly $64,000 of orders over the year, invoiced monthly on net 30 terms.
We only need delivery addresses and headcounts; we don't collect or store any personal data about attendees.
We'd like to start on 2027-01-11.

Thanks,
Jules`,
  },
  {
    id: 'sample-gaps',
    title: 'Notes from a call with an analytics vendor',
    text: `Call notes, 29 Oct
Vendor: Tallowbrook Analytics (legal entity name to confirm, maybe "Tallowbrook Analytics LLC").
Contact: Sam, sam@tallowbrook (they'll send the full address).
They'll process customer survey responses including names and emails.
Budget discussed: about 140k a year.
They asked for 15-day payment terms.
Start: "early next quarter", no exact date yet.
Tax ID: they will send it after legal review.`,
  },
];
