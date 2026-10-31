/**
 * Sandboxed document builders for the two code lanes (CustomWidget, ReactArtifact).
 * Pure string functions, shared by the client renderer and the server preview route
 * (the Impeccable loop scans a rendered artifact at a stable URL).
 */
const WIDGET_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; form-action 'none'";
// The artifact iframe is an opaque origin (sandbox=allow-scripts, no allow-same-origin),
// so it cannot read the parent page. Two runtime needs still have to be allowed
// *inside that frame*: Babel's `new Function` ('unsafe-eval') and the module lane's
// `import(blob:)` ('blob:'). connect-src is the CDN hosts plus the public data APIs
// named in the system prompt — not every https origin.
const ARTIFACT_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval' blob: https://unpkg.com https://cdn.tailwindcss.com https://esm.sh",
  "style-src 'unsafe-inline' https://cdn.tailwindcss.com https://fonts.googleapis.com",
  "img-src data: blob: https://unpkg.com https://cdn.tailwindcss.com https://esm.sh",
  "font-src data: https://cdn.tailwindcss.com https://esm.sh https://fonts.gstatic.com",
  "connect-src https://unpkg.com https://cdn.tailwindcss.com https://esm.sh https://api.open-meteo.com https://api.coingecko.com https://api.github.com",
  "worker-src blob:",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ');

function neutralizeClosers(source: string): string {
  return source.replace(/<\/(script|style)/gi, '<\\/$1');
}

/** Self-contained document for Lane B. CSP blocks network, matching the prompt. */
export function customWidgetSrcDoc(html: string, css: string, script: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${WIDGET_CSP}"><style>${neutralizeClosers(css)}</style></head><body>${html}` +
    `<scr` + `ipt>${neutralizeClosers(script)}</scr` + `ipt>` +
    `<scr` + `ipt>${TEXT_POSTER}</scr` + `ipt></body></html>`;
}

// ===== Freeform React/Tailwind lane (sandboxed, CDN runtime) =============
// The model writes a real React component (`function App(){…}`) using Tailwind.
// It is transpiled by Babel and rendered inside an isolated iframe
// (sandbox="allow-scripts", no same-origin) so it cannot touch the parent page.
// React/ReactDOM/Babel/Tailwind load from CDN. The iframe posts its content
// height back so the frame auto-sizes to the design.
// Posts a text digest of the iframe's content to the parent, so the voice agent's
// read_ui can "see" inside the otherwise cross-origin sandbox.
const TEXT_POSTER =
  'var __lt=0;function __digest(){var parts=[];var nodes=document.querySelectorAll("input,textarea,select");for(var i=0;i<nodes.length;i++){var el=nodes[i];var t=(el.type||"").toLowerCase();if(t==="hidden"||t==="button"||t==="submit"||t==="range"||t==="file")continue;var name=el.getAttribute("aria-label")||el.getAttribute("name")||el.getAttribute("placeholder")||el.id||("field "+(i+1));var v="";if(t==="checkbox"){v=el.checked?"on":"off";}else if(t==="radio"){if(!el.checked)continue;v=el.value||"on";}else{v=el.value||"";}if(v!=="")parts.push(name+": "+v);}var text=((document.body&&document.body.innerText)||"").replace(/\\s+/g," ").trim();if(parts.length)text=(text?text+" · ":"")+parts.join(" · ");return text.slice(0,3000);}function __pt(){try{var n=Date.now();if(n-__lt<700)return;__lt=n;parent.postMessage({__artifactText:__digest()},"*");}catch(e){}}setTimeout(__pt,800);setTimeout(__pt,2500);try{new MutationObserver(__pt).observe(document.documentElement,{subtree:true,childList:true,characterData:true});document.addEventListener("input",__pt,true);document.addEventListener("change",__pt,true);}catch(e){}';

// A sandbox without allow-same-origin throws on localStorage/sessionStorage and
// has no nice way to surface errors. Install in-memory storage shims + a small
// error reporter; shared by both runtimes.
const ARTIFACT_SHIM =
  'window.__err=function(m){var r=document.getElementById("root");if(r){r.innerHTML="";var p=document.createElement("pre");p.style.cssText="color:#f87171;padding:16px;font:12px ui-monospace,monospace;white-space:pre-wrap";p.textContent=String(m);r.appendChild(p);}};' +
  'window.addEventListener("error",function(e){window.__err((e&&e.message)||String(e));});' +
  'window.addEventListener("unhandledrejection",function(e){window.__err((e&&e.reason&&e.reason.message)||String(e&&e.reason));});' +
  'try{var _mk=function(){var m={};var s={getItem:function(k){return Object.prototype.hasOwnProperty.call(m,k)?m[k]:null;},setItem:function(k,v){m[k]=String(v);},removeItem:function(k){delete m[k];},clear:function(){m={};},key:function(i){return Object.keys(m)[i]||null;}};Object.defineProperty(s,"length",{get:function(){return Object.keys(m).length;}});return s;};' +
  'Object.defineProperty(window,"localStorage",{configurable:true,value:_mk()});Object.defineProperty(window,"sessionStorage",{configurable:true,value:_mk()});}catch(e){}' +
  TEXT_POSTER;

const escScript = (code: string): string => JSON.stringify(code).replace(/<\//g, '<\\/');

// Classic lane: global React UMD + Babel classic. Hooks are pre-destructured;
// no import/export. Best for small self-contained components. Auto-resizes.
function buildClassicDoc(code: string): string {
  const prelude =
    'const {useState,useEffect,useRef,useMemo,useCallback,useReducer}=React;' +
    'class ErrorBoundary extends React.Component{constructor(p){super(p);this.state={err:0};}static getDerivedStateFromError(){return {err:1};}componentDidCatch(e){window.__err&&window.__err((e&&e.message)||e);}render(){return this.state.err?null:this.props.children;}}';
  const epilogue =
    'const _r=ReactDOM.createRoot(document.getElementById("root"));_r.render(React.createElement(ErrorBoundary,null,React.createElement(App)));' +
    'function _ph(){try{parent.postMessage({__artifactHeight:document.documentElement.scrollHeight},"*");}catch(e){}}try{new ResizeObserver(_ph).observe(document.body);}catch(e){}setTimeout(_ph,60);setTimeout(_ph,500);';
  const runner =
    'try{var _src=' + escScript(code) + ';var _full=' + JSON.stringify(prelude) + '+"\\n"+_src+"\\n"+' + JSON.stringify(epilogue) + ';' +
    'var _out=Babel.transform(_full,{presets:[["react",{runtime:"classic"}]]}).code;new Function(_out)();}catch(e){window.__err((e&&e.message)||e);}';
  return '<!doctype html><html><head><meta charset="utf-8">' +
    `<meta http-equiv="Content-Security-Policy" content="${ARTIFACT_CSP}">` +
    '<script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>' +
    '<script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>' +
    '<script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>' +
    '<script src="https://cdn.tailwindcss.com"></script>' +
    '<style>html,body{margin:0;background:transparent}#root{min-height:100%}</style>' +
    '</head><body><div id="root"></div><script>' + ARTIFACT_SHIM + '</script><script>' + runner + '</script></body></html>';
}

// Module lane: import maps + esm.sh, Babel automatic, run as a blob module.
// Lets the model `import` real npm packages (lucide-react, hls.js, framer-motion).
function buildModuleDoc(code: string): string {
  const importMap = JSON.stringify({
    imports: {
      react: 'https://esm.sh/react@18.3.1',
      'react-dom': 'https://esm.sh/react-dom@18.3.1',
      'react-dom/client': 'https://esm.sh/react-dom@18.3.1/client',
      'react/jsx-runtime': 'https://esm.sh/react@18.3.1/jsx-runtime',
      'lucide-react': 'https://esm.sh/lucide-react@0.439.0?external=react',
      'hls.js': 'https://esm.sh/hls.js@1.5.15',
      'framer-motion': 'https://esm.sh/framer-motion@11?external=react,react-dom',
      // charts / dataviz
      recharts: 'https://esm.sh/recharts@2?external=react,react-dom',
      d3: 'https://esm.sh/d3@7',
      // 3D
      three: 'https://esm.sh/three@0.160.0',
      '@react-three/fiber': 'https://esm.sh/@react-three/fiber@8?external=react,react-dom,three',
      // drag & drop
      '@dnd-kit/core': 'https://esm.sh/@dnd-kit/core@6?external=react,react-dom',
      '@dnd-kit/sortable': 'https://esm.sh/@dnd-kit/sortable@8?external=react,react-dom',
      '@dnd-kit/utilities': 'https://esm.sh/@dnd-kit/utilities@3?external=react',
      // misc utilities
      gsap: 'https://esm.sh/gsap@3',
      'react-markdown': 'https://esm.sh/react-markdown@9?external=react',
      'date-fns': 'https://esm.sh/date-fns@3',
      'canvas-confetti': 'https://esm.sh/canvas-confetti@1',
      clsx: 'https://esm.sh/clsx@2',
      zustand: 'https://esm.sh/zustand@4?external=react',
      'react-icons/': 'https://esm.sh/react-icons@5.3.0/',
    },
  });
  const mount = "\n;import { createRoot as __cr } from 'react-dom/client';\n__cr(document.getElementById('root')).render(<App/>);";
  const runner =
    'try{var _src=' + escScript(code) + ';var _full=_src+' + JSON.stringify(mount) + ';' +
    'var _out=Babel.transform(_full,{presets:[["react",{runtime:"automatic"}]],filename:"app.jsx"}).code;' +
    'var _u=URL.createObjectURL(new Blob([_out],{type:"text/javascript"}));import(_u).catch(function(e){window.__err((e&&e.message)||String(e));});}catch(e){window.__err((e&&e.message)||e);}';
  return '<!doctype html><html><head><meta charset="utf-8">' +
    `<meta http-equiv="Content-Security-Policy" content="${ARTIFACT_CSP}">` +
    '<script src="https://cdn.tailwindcss.com"></script>' +
    '<script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>' +
    '<script type="importmap">' + importMap + '</script>' +
    '<style>html,body{margin:0;background:transparent;height:100%}#root{height:100%;min-height:100%}</style>' +
    '</head><body><div id="root"></div><script>' + ARTIFACT_SHIM + '</script><script>' + runner + '</script></body></html>';
}

export function buildArtifactDoc(code: string): string {
  // ES `import` statements → module lane; otherwise the simple classic lane.
  const usesImports = /(^|[\n;])\s*import\s.+from\s/.test(code) || /(^|[\n;])\s*import\s+['"]/.test(code);
  return usesImports ? buildModuleDoc(code) : buildClassicDoc(code);
}
