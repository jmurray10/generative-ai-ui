# Dense Ops Console
Feel: an air-traffic or trading console. Maximum information per pixel, zero decoration, every pixel earns its place.
Type: UI "IBM Plex Sans" 400/500 at 13/18; data "JetBrains Mono" 12/16 with tabular numerals; headings are 13 uppercase 600 with 0.06em tracking. No size above 20.
Color: dark. bg #0E1116, panel #151A21, line #232A33, text #D6DDE6, muted #7D8896. Status only, never decorative: ok #3FB68B, warn #E0A93B, bad #E5534B, info #4C9AFF. Status always paired with a text label or icon, never color alone.
Layout: 4px grid, 8px gutters, panels tile edge to edge with 1px lines, no outer page padding over 12px. Resizable split panes, sticky table headers, right-side detail drawer 420px.
Components: tables are the hero (row height 28, sortable, column filters, keyboard j/k nav); status dot 6px plus label instead of colored left borders; buttons 28px tall, radius 4, ghost by default; command palette on Cmd-K.
States: every panel has explicit empty, loading (skeleton rows matching real row height), error with retry, and stale ("last updated 3m ago") states.
Never: cards with shadows, side-tab borders, gradients, big hero type, purple, spinners over 300ms without text.
