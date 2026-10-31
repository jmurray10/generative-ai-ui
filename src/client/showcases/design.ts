import { useEffect } from 'react';
import type { DesignSystem } from '../../shared/toolbox';
import '../../../design/editorial-serif/tokens.css';
import '../../../design/ops-console/tokens.css';
import '../../../design/soft-consumer/tokens.css';

const FONTS: Record<DesignSystem, string> = {
  editorial_serif: 'family=Newsreader:wght@400;600&family=Source+Serif+4:wght@400;600&family=IBM+Plex+Sans:wght@400;500;600',
  ops_console: 'family=IBM+Plex+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500',
  soft_consumer: 'family=Figtree:wght@400;600',
};

/** Load the Google Fonts a DESIGN.md names, once per design system. */
export function useDesignFonts(ids: DesignSystem[]): void {
  const key = ids.join(',');
  useEffect(() => {
    for (const id of key.split(',') as DesignSystem[]) {
      if (!FONTS[id] || document.querySelector(`link[data-design-font="${id}"]`)) continue;
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = `https://fonts.googleapis.com/css2?${FONTS[id]}&display=swap`;
      link.dataset.designFont = id;
      document.head.appendChild(link);
    }
  }, [key]);
}
