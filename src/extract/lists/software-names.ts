// FR-19: property values filled in by software or left at a default. They are not evidence.

/** Whole values that are defaults or bare product names. Matched exactly, so "Pixel Labs Ltd" survives. */
const DEFAULT_VALUES: ReadonlySet<string> = new Set([
  'user', 'admin', 'administrator', 'microsoft office user', 'windows user', 'owner', 'author',
  'unknown', 'default', 'test', 'pc', 'guest', 'root', 'name', 'your name', 'office', 'home',
  'customer', 'client', 'staff', 'employee', 'none', 'n/a', 'na', 'untitled', 'document',
  'presentation', 'workbook', 'sheet1', 'book1', 'copyright', 'all rights reserved',
  'word', 'excel', 'powerpoint', 'writer', 'pages', 'keynote', 'numbers', 'docs', 'sheets',
  'slides', 'chrome', 'safari', 'firefox', 'edge', 'camera', 'scanner', 'printer', 'iphone',
  'ipad', 'android', 'figma', 'sketch', 'gimp', 'inkscape', 'canva', 'preview',
]);

/** Brand and tool names that are never a client's own name. */
const SOFTWARE_PATTERN =
  /\b(microsoft|msword|adobe|acrobat|distiller|libreoffice|openoffice|photoshop|illustrator|indesign|lightroom|google docs|google sheets|google slides|skia|quartz|ghostscript|itext|itextsharp|tcpdf|fpdf|dompdf|mpdf|wkhtmltopdf|pdfium|pdfsharp|pdf-lib|pdfkit|reportlab|latex|pdftex|xetex|luatex|wps office|apache poi|python-docx|openpyxl|aspose|nitro pro|foxit|smallpdf|ilovepdf|mac os|macos|windows|samsung|canon|nikon|fujifilm|huawei|xiaomi|epson|xerox|ricoh)\b/i;

/** True when a property value names software, a device or a default rather than a person or company. */
export function isSoftwareOrDefault(value: string): boolean {
  const v = value.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!v || !/\p{L}/u.test(v)) return true;
  if (DEFAULT_VALUES.has(v)) return true;
  if (SOFTWARE_PATTERN.test(v)) return true;
  if (/\d+\.\d+/.test(v)) return true; // version numbers: "Creator 2.4.1"
  if (/^[\w.-]+\.(pdf|docx?|xlsx?|pptx?|jpe?g|png|txt)$/i.test(v)) return true; // a file name as title
  return false;
}
