import type { Blockquote, Paragraph, PhrasingContent, Root, RootContent } from 'mdast';

export const ALERT_TITLES = {
  note: 'Note',
  tip: 'Tip',
  important: 'Important',
  warning: 'Warning',
  caution: 'Caution',
} as const;

export type AlertType = keyof typeof ALERT_TITLES;

/** Classes the sanitize schema must allow on the alert `div` (and its title `p`). */
export const ALERT_CLASSES = [
  'markdown-alert',
  ...Object.keys(ALERT_TITLES).map((t) => `markdown-alert-${t}`),
];
export const ALERT_TITLE_CLASS = 'markdown-alert-title';

const MARKER = /^\[!(note|tip|important|warning|caution)\][ \t]*(\r?\n)?/i;

/**
 * GitHub alerts (FR-3.7): a blockquote whose first line is exactly `[!NOTE]`, `[!TIP]`,
 * `[!IMPORTANT]`, `[!WARNING]` or `[!CAUTION]` (any case) and that has content after it becomes
 * `div.markdown-alert.markdown-alert-<type>` with a `p.markdown-alert-title` first. Anything else
 * (text after the marker on the same line, no content) stays a plain blockquote.
 */
export default function remarkAlerts() {
  return (tree: Root) => {
    walk(tree.children);
  };
}

function walk(nodes: RootContent[]): void {
  for (const node of nodes) {
    if (node.type === 'blockquote') toAlert(node);
    if ('children' in node) walk(node.children as RootContent[]);
  }
}

function toAlert(quote: Blockquote): void {
  const first = quote.children[0];
  if (first?.type !== 'paragraph') return;
  const head = first.children[0];
  if (head?.type !== 'text') return;
  const m = MARKER.exec(head.value);
  if (!m) return;

  const rest = head.value.slice(m[0].length);
  let inline: PhrasingContent[] = first.children.slice(1);
  if (m[2] !== undefined) {
    if (rest !== '') inline = [{ ...head, value: rest }, ...inline];
  } else {
    // No newline in the text node: the marker must end the line (hard break) or the paragraph.
    if (rest !== '' || (inline.length > 0 && inline[0].type !== 'break')) return;
    inline = inline.slice(1);
  }
  const body = [
    ...(inline.length > 0 ? [{ ...first, children: inline } satisfies Paragraph] : []),
    ...quote.children.slice(1),
  ];
  if (body.length === 0) return;

  const type = m[1].toLowerCase() as AlertType;
  const title: Paragraph = {
    type: 'paragraph',
    data: { hProperties: { className: [ALERT_TITLE_CLASS] } },
    children: [{ type: 'text', value: ALERT_TITLES[type] }],
  };
  quote.data = {
    ...quote.data,
    hName: 'div',
    hProperties: { className: ['markdown-alert', `markdown-alert-${type}`] },
  };
  quote.children = [title, ...body];
}
