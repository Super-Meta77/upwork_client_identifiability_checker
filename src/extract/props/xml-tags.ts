// D-26: read the text of simple elements in docProps XML without DOMParser, so parsing stays pure
// and works in tests and workers alike.

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeXmlText(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(?:#x([0-9a-f]+)|#(\d+)|(amp|lt|gt|quot|apos));/gi, (_m, hex: string, dec: string, name: string) => {
      if (hex) return String.fromCodePoint(parseInt(hex, 16));
      if (dec) return String.fromCodePoint(parseInt(dec, 10));
      return ENTITIES[name.toLowerCase()] ?? '';
    })
    .trim();
}

/** Text of the first element whose local name matches, with any namespace prefix: <dc:creator>. */
export function readXmlTag(xml: string, localName: string): string | null {
  const re = new RegExp(`<(?:[\\w.-]+:)?${localName}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w.-]+:)?${localName}>`, 'i');
  const match = re.exec(xml);
  if (!match) return null;
  const value = decodeXmlText(match[1] ?? '');
  return value || null;
}
