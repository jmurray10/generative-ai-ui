/**
 * Showcase C data and verification. Every document here is synthetic: the
 * companies, people and numbers are invented for the demo.
 */

export interface DocPage { page: number; lines: string[] }
export interface ReviewDoc { id: string; title: string; kind: string; submittedBy: string; received: string; pages: DocPage[]; questions: string[] }

export interface Citation { page: number; line: number; quote: string }
export interface Claim { text: string; citations: Citation[] }
export interface VerifiedCitation extends Citation { verified: boolean; reason?: string }
export interface VerifiedClaim { text: string; citations: VerifiedCitation[]; verified: boolean }

export type AnswerStatus = 'verified' | 'couldnt_verify';
export interface WorkbenchAnswer {
  docId: string;
  question: string;
  answer: string;
  notInDocument: boolean;
  claims: VerifiedClaim[];
  status: AnswerStatus;
  /** Why the answer could not be verified, in plain words. Empty when verified. */
  problems: string[];
  model: string;
}

export const REVIEW_DOCS: ReviewDoc[] = [
  {
    id: 'doc-104',
    title: 'Facilities services agreement',
    kind: 'Contract',
    submittedBy: 'Dana Okafor',
    received: '2026-10-27',
    questions: [
      'How much notice is needed to terminate, and does the agreement renew automatically?',
      'What late-payment interest rate does the agreement set?',
    ],
    pages: [
      { page: 1, lines: [
        'FACILITIES SERVICES AGREEMENT',
        'This agreement is made on 1 March 2026 between Harborview Clinic Group ("Client")',
        'and Pinecrest Maintenance LLC ("Provider").',
        '1. Services. Provider will clean and maintain the three Client sites listed in Schedule A.',
        '2. Fees. Client will pay a monthly fee of $18,400, invoiced on the first business day of each month.',
        '3. Payment. Invoices are due within 30 days of receipt.',
        '4. Term. The initial term is 24 months from the start date.',
        '5. Renewal. After the initial term, this agreement renews automatically for successive 12-month periods',
        'unless either party gives written notice of non-renewal at least 60 days before the end of the current term.',
      ] },
      { page: 2, lines: [
        '6. Termination for convenience. Either party may terminate this agreement for any reason',
        'by giving 90 days written notice to the other party.',
        '7. Termination for cause. Either party may terminate immediately if the other party materially breaches',
        'this agreement and fails to cure the breach within 15 days of notice.',
        '8. Insurance. Provider will keep general liability insurance of at least $2,000,000 per occurrence.',
        '9. Notices. Notices must be sent by email and by courier to the addresses in Schedule B.',
        '10. Governing law. This agreement is governed by the laws of the State of Oregon.',
      ] },
    ],
  },
  {
    id: 'doc-117',
    title: 'Equipment lease',
    kind: 'Lease',
    submittedBy: 'Marco Lindqvist',
    received: '2026-10-28',
    questions: ['What is the monthly payment and who pays for repairs?', 'Is there a purchase option at the end of the lease?'],
    pages: [
      { page: 1, lines: [
        'EQUIPMENT LEASE',
        'Lessor: Brightline Equipment Finance. Lessee: Larkspur Bakery Co.',
        'Equipment: two deck ovens (model DX-40) and one spiral mixer (model SM-80).',
        'Lease term: 36 months starting 15 November 2026.',
        'Monthly payment: $1,275, due on the 15th of each month.',
        'Maintenance. Lessee is responsible for routine cleaning.',
        'Lessor is responsible for repairs caused by normal wear and manufacturing defects.',
        'End of term. Lessee may buy the equipment for $1 at the end of the lease term.',
      ] },
    ],
  },
  {
    id: 'doc-121',
    title: 'Data processing addendum',
    kind: 'Addendum',
    submittedBy: 'Priya Raman',
    received: '2026-10-29',
    questions: ['How quickly must a data breach be reported?', 'Where may personal data be stored?'],
    pages: [
      { page: 1, lines: [
        'DATA PROCESSING ADDENDUM',
        'Parties: Meridian Tutoring Inc. ("Controller") and Quillstone Software Ltd. ("Processor").',
        'Purpose. Processor hosts the Controller\'s scheduling app and stores student contact details.',
        'Security incidents. Processor will notify Controller of a personal data breach within 48 hours',
        'of becoming aware of it.',
        'Subprocessors. Processor must get written approval before adding a new subprocessor.',
        'Deletion. Processor will delete personal data within 30 days after the agreement ends.',
      ] },
      { page: 2, lines: [
        'Data location. Personal data will be stored only in data centers located in Canada or the United States.',
        'Audits. Controller may audit Processor once per calendar year with 14 days notice.',
      ] },
    ],
  },
];

const norm = (s: string) => s.toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/[^a-z0-9$%.,'"]+/g, ' ').trim();

/**
 * A citation is verified only when its quote appears on the cited line (or runs
 * from that line into the next one). Page and line numbers are 1-based.
 */
export function verifyCitation(doc: ReviewDoc, c: Citation): VerifiedCitation {
  const page = doc.pages.find((p) => p.page === c.page);
  if (!page) return { ...c, verified: false, reason: `page ${c.page} does not exist` };
  const line = page.lines[c.line - 1];
  if (line === undefined) return { ...c, verified: false, reason: `page ${c.page} has no line ${c.line}` };
  const q = norm(c.quote ?? '');
  if (q.length < 8) return { ...c, verified: false, reason: 'quote too short to check' };
  const here = norm(line);
  const span = norm(`${line} ${page.lines[c.line] ?? ''}`);
  if (here.includes(q) || span.includes(q)) return { ...c, verified: true };
  return { ...c, verified: false, reason: `quote not found on page ${c.page}, line ${c.line}` };
}

export function verifyAnswer(doc: ReviewDoc, raw: { answer: string; notInDocument?: boolean; claims?: Claim[] }): Pick<WorkbenchAnswer, 'claims' | 'status' | 'problems' | 'notInDocument' | 'answer'> {
  const claims: VerifiedClaim[] = (raw.claims ?? []).map((cl) => {
    const citations = (cl.citations ?? []).map((c) => verifyCitation(doc, c));
    return { text: cl.text, citations, verified: citations.length > 0 && citations.every((c) => c.verified) };
  });
  const problems: string[] = [];
  if (raw.notInDocument) problems.push('The model says the document does not state this.');
  if (!claims.length) problems.push('No claim came with a citation.');
  for (const cl of claims) {
    if (!cl.citations.length) problems.push(`"${cl.text}" has no citation.`);
    for (const c of cl.citations) if (!c.verified) problems.push(`"${cl.text}": ${c.reason}.`);
  }
  const status: AnswerStatus = problems.length ? 'couldnt_verify' : 'verified';
  return { answer: raw.answer, notInDocument: Boolean(raw.notInDocument), claims, status, problems };
}

/** The document as numbered lines, which is what the model sees. */
export function numberedText(doc: ReviewDoc): string {
  return doc.pages.map((p) => `--- page ${p.page} ---\n` + p.lines.map((l, i) => `[p${p.page} L${i + 1}] ${l}`).join('\n')).join('\n');
}
