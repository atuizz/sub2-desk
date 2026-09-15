import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { buildApiUrl } from '../api/url';

export function safeExternalUrl(value: string): string {
  const raw = value.trim();
  if (!/^https?:\/\//i.test(raw) || /[\u0000-\u0020\u007f\\]/.test(raw)) return '';
  try {
    const url = new URL(raw);
    return url.username || url.password ? '' : url.href;
  } catch { return ''; }
}

export function safeContentUrl(value: string): string {
  const raw = value.trim();
  if (/^https?:\/\//i.test(raw)) return safeExternalUrl(raw);
  if (!raw || /[\u0000-\u0020\u007f\\]/.test(raw) || raw.startsWith('//')) return '';
  try {
    const decoded = decodeURIComponent(raw);
    if (/[\u0000-\u001f\u007f\\]/.test(decoded) || decoded.startsWith('//') || /^[^/?#]*:/.test(decoded)) return '';
    const url = new URL(raw, 'https://content.invalid/');
    return url.origin === 'https://content.invalid' ? raw : '';
  } catch { return ''; }
}
function headingAnchor(text: string): string {
  return text.trim().toLowerCase().replace(/[^\p{L}\p{N}_\s-]/gu, '').replace(/\s/g, '-');
}

// Reconstruct an inert template into an explicit text/formatting allowlist.
// Never attach original nodes or their attributes; no scripts, CSS, SVG, forms,
// frames, event handlers, named DOM properties, remote images or media survive.
const allowed = new Set('P BR HR H1 H2 H3 H4 H5 H6 STRONG B EM I U S DEL BLOCKQUOTE PRE CODE UL OL LI TABLE THEAD TBODY TFOOT TR TH TD A IMG'.split(' '));
const discard = new Set('SCRIPT STYLE IFRAME OBJECT EMBED SVG MATH FORM INPUT BUTTON TEXTAREA SELECT LINK META BASE TEMPLATE NOSCRIPT'.split(' '));
export function renderSafeContent(source: string, markdown = true, slug = ''): string {
  const input = document.createElement('template');
  input.innerHTML = DOMPurify.sanitize(markdown ? marked.parse(source, { async: false, breaks: true, gfm: true }) : source, {
    ALLOWED_TAGS: [...allowed].map(tag => tag.toLowerCase()),
    ALLOWED_ATTR: ['href', 'src', 'alt', 'id'],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
  });
  const output = document.createElement('div');
  const anchors = new Map<string, number>();
  function append(node: Node, parent: Node) {
    if (node.nodeType === 3) { parent.appendChild(document.createTextNode(node.textContent || '')); return; }
    if (node.nodeType !== 1) return;
    const original = node as Element;
    if (discard.has(original.tagName)) return;
    if (!allowed.has(original.tagName)) { for (const child of [...node.childNodes]) append(child, parent); return; }
    const element = document.createElement(original.tagName.toLowerCase());
    if (/^H[1-6]$/.test(original.tagName)) {
      const base = headingAnchor(original.textContent || '') || 'section';
      const occurrence = anchors.get(base) || 0;
      anchors.set(base, occurrence + 1);
      const anchor = base + (occurrence ? `-${occurrence}` : '');
      element.setAttribute('data-content-anchor', anchor);
      element.id = 'sub2-content-' + anchor;
      const explicit = original.getAttribute('id');
      if (explicit) element.setAttribute('data-content-original-anchor', explicit);
    }
    if (original.tagName === 'A') {
      const href = safeContentUrl(original.getAttribute('href') || '');
      if (href) {
        element.setAttribute('href', href);
        if (safeExternalUrl(href)) { element.setAttribute('target', '_blank'); element.setAttribute('rel', 'noopener noreferrer'); element.setAttribute('referrerpolicy', 'no-referrer'); }
      }
    }
    if (original.tagName === 'IMG') {
      const src = original.getAttribute('src') || '';
      element.setAttribute('alt', original.getAttribute('alt') || '');
      // Only page-local assets, under the current page's fixed API prefix.
      if (!/^[\p{L}\p{N}_-]+$/u.test(slug) || !src || /[\\%?#:\u0000-\u0020]/.test(src) || src.startsWith('/')
        || src.split('/').some(part => !part || part === '..' || part === '.')) {
        parent.appendChild(document.createTextNode(element.getAttribute('alt') || '')); return;
      }
      element.setAttribute('src', buildApiUrl(`/pages/${encodeURIComponent(slug)}/images/${src.split('/').map(encodeURIComponent).join('/')}`));
      element.setAttribute('loading', 'lazy'); element.setAttribute('referrerpolicy', 'no-referrer');
    }
    for (const child of [...node.childNodes]) append(child, element);
    parent.appendChild(element);
  }
  for (const node of [...input.content.childNodes]) append(node, output);
  return output.innerHTML;
}

export type PublicRoute = { page: 'home' | 'key-usage' | 'legal' | 'custom' | 'model-plaza' | 'monitor' | 'available-channels'; id?: string };
export function resolvePublicRoute(path: string): PublicRoute | null {
  const pathname = path.split(/[?#]/, 1)[0].replace(/\/$/, '');
  const simple = /^\/(home|key-usage|model-plaza|monitor|available-channels)$/.exec(pathname);
  if (simple) return { page: simple[1] as PublicRoute['page'] };
  const match = /^\/(legal|custom)\/([^/]+)$/.exec(pathname);
  if (!match) return null;
  try {
    const id = decodeURIComponent(match[2]);
    if (!/^[\p{L}\p{N}_-]+$/u.test(id)) return null;
    return { page: match[1] as 'legal' | 'custom', id };
  } catch { return null; }
}
