import React, { useCallback, useEffect, useState } from 'react';
import type { DesignSystem } from '../../shared/toolbox';
import { VoicePanel } from '../voice/VoicePanel';
import { useDesignFonts } from './design';
import { CritiqueShowcase } from './CritiqueShowcase';
import { DesignSystemsShowcase } from './DesignSystemsShowcase';
import { WorkbenchShowcase } from './WorkbenchShowcase';
import { IntakeShowcase } from './IntakeShowcase';

export const PAGES = [
  { id: 'critique', label: 'A · Self-critiquing generator' },
  { id: 'design-systems', label: 'B · One prompt, three design systems' },
  { id: 'workbench', label: 'C · Review workbench' },
  { id: 'intake', label: 'D · Intake wizard' },
] as const;
export type PageId = (typeof PAGES)[number]['id'];

/** Per-page design system before the decision layer has routed. */
const DEFAULT_DESIGN: Record<PageId, DesignSystem> = {
  critique: 'ops_console',
  'design-systems': 'editorial_serif',
  workbench: 'ops_console',
  intake: 'soft_consumer',
};

function pageFromPath(path: string): PageId {
  const id = path.replace(/^\/showcases\/?/, '').split('/')[0];
  return (PAGES.find((p) => p.id === id)?.id ?? 'critique') as PageId;
}

/** Everything voice can read: each [data-voice-surface] region plus sandboxed-iframe digests. */
function readSurfaces(): string {
  const parts = Array.from(document.querySelectorAll<HTMLElement>('[data-voice-surface]')).map((el) => {
    const label = el.dataset.voiceSurface;
    return `${label}: ${el.innerText.replace(/\s+/g, ' ').trim()}`;
  });
  const frames = Array.from(document.querySelectorAll<HTMLElement>('iframe[data-artifact-text]')).map((el) => el.dataset.artifactText || '').filter(Boolean);
  if (frames.length) parts.push(`Rendered preview: ${frames.join(' · ')}`);
  return parts.join(' || ').slice(0, 12000);
}

export const Showcases: React.FC = () => {
  const page = pageFromPath(window.location.pathname);
  const [design, setDesign] = useState<DesignSystem>(DEFAULT_DESIGN[page]);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [surfaceVersion, setSurfaceVersion] = useState(0);
  useDesignFonts(['editorial_serif', 'ops_console', 'soft_consumer']);

  // The showcase body owns the page background, not the playground's gradient.
  useEffect(() => {
    const { style } = document.body;
    const prev = style.backgroundImage;
    style.backgroundImage = 'none';
    return () => { style.backgroundImage = prev; };
  }, []);

  const getContext = useCallback(() => ({ spec: null, readable: readSurfaces() }), []);
  const bump = useCallback(() => setSurfaceVersion((n) => n + 1), []);

  const body = {
    critique: <CritiqueShowcase onDesign={setDesign} onChange={bump} />,
    'design-systems': <DesignSystemsShowcase onDesign={setDesign} onChange={bump} />,
    workbench: <WorkbenchShowcase onDesign={setDesign} onChange={bump} />,
    intake: <IntakeShowcase onDesign={setDesign} onChange={bump} />,
  }[page];

  return (
    <div data-design={design} className="min-h-full bg-canvas text-ink">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-edge px-4 py-2">
        <a href="/" className="font-display text-sm font-semibold text-ink">GenUI Playground</a>
        <nav aria-label="Showcases" className="flex flex-wrap gap-1">
          {PAGES.map((p) => (
            <a
              key={p.id}
              href={`/showcases/${p.id}`}
              aria-current={p.id === page ? 'page' : undefined}
              className={`rounded-lg px-2 py-1 text-sm ${p.id === page ? 'bg-panel text-ink underline underline-offset-4' : 'text-muted hover:text-ink'}`}
            >
              {p.label}
            </a>
          ))}
        </nav>
        <button
          type="button"
          onClick={() => setVoiceOpen((o) => !o)}
          aria-expanded={voiceOpen}
          className="ml-auto rounded-lg border border-edge px-3 py-1 text-sm text-ink hover:border-accent"
        >
          {voiceOpen ? 'Voice on' : 'Talk with Grok'}
        </button>
      </header>
      <main className="px-4 py-4">{body}</main>
      {voiceOpen && (
        <VoicePanel
          providerLabel="Grok"
          getContext={getContext}
          onSpec={() => {}}
          specVersion={surfaceVersion}
          onClose={() => setVoiceOpen(false)}
          starters={['Read me what the page says', 'What did the decision layer pick and why?']}
        />
      )}
    </div>
  );
};

export interface ShowcaseProps {
  onDesign: (d: DesignSystem) => void;
  /** Tell the voice session the readable page changed. */
  onChange: () => void;
}
