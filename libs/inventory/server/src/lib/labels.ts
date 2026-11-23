import PDFDocument from 'pdfkit';
import { code128Bars, code128Modules } from '@dax/inventory-contract';

export const LABEL_SHEET = {
  pageWidthMm: 210,
  pageHeightMm: 297,
  columns: 3,
  rows: 8,
  cellWidthMm: 70,
  cellHeightMm: 37,
  marginLeftMm: 0,
  marginTopMm: 0.5,
  gapXMm: 0,
  gapYMm: 0,
  paddingMm: 3,
  barcodeHeightMm: 11,
  quietModules: 10,
} as const;

export type SheetGeometry = typeof LABEL_SHEET;

export const perSheet = (g: SheetGeometry = LABEL_SHEET) => g.columns * g.rows;

export interface LabelSlot {
  page: number;
  row: number;
  column: number;
  xMm: number;
  yMm: number;
}

export function labelSlots(
  count: number,
  skip: number,
  g: SheetGeometry = LABEL_SHEET,
): LabelSlot[] {
  const size = perSheet(g);
  const slots: LabelSlot[] = [];
  for (let i = 0; i < count; i++) {
    const index = skip + i;
    const within = index % size;
    const row = Math.floor(within / g.columns);
    const column = within % g.columns;
    slots.push({
      page: Math.floor(index / size),
      row,
      column,
      xMm: g.marginLeftMm + column * (g.cellWidthMm + g.gapXMm),
      yMm: g.marginTopMm + row * (g.cellHeightMm + g.gapYMm),
    });
  }
  return slots;
}

export function withCopies<T>(labels: readonly T[], copies: number): T[] {
  return labels.flatMap((label) => Array.from({ length: copies }, () => label));
}

export type LabelContent =
  | {
      kind: 'item';
      /** Label token, encoded in the Code 128 barcode. */
      token: string;
      partNo: string;
      brand: string;
      description: string;
      uom: string;
    }
  | {
      kind: 'bin';
      token: string;
      code: string;
      zone: string;
      binKind: string | null;
    };

const PT_PER_MM = 72 / 25.4;
export const mm = (value: number) => value * PT_PER_MM;

type Doc = PDFKit.PDFDocument;

/** Code 128 bars across `w`, `h` tall, with quiet zones inside the width. */
function drawBarcode(
  doc: Doc,
  text: string,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const quiet = LABEL_SHEET.quietModules;
  const module = w / (code128Modules(text) + quiet * 2);
  for (const [start, width] of code128Bars(text)) {
    doc.rect(x + (start + quiet) * module, y, width * module, h);
  }
  doc.fillColor('black').fill();
}

function fitSize(
  doc: Doc,
  text: string,
  font: string,
  width: number,
  max: number,
  min: number,
): number {
  doc.font(font);
  let size = max;
  while (size > min && doc.fontSize(size).widthOfString(text) > width) {
    size -= 0.5;
  }
  return size;
}

function line(
  doc: Doc,
  text: string,
  font: string,
  size: number,
  x: number,
  y: number,
  width: number,
  lines = 1,
): number {
  doc.font(font).fontSize(size);
  const height = doc.currentLineHeight(true) * lines;
  doc.text(text, x, y, { width, height, ellipsis: true, lineGap: 0 });
  return y + height + mm(0.8);
}

const BIN_KIND_LABEL: Record<string, string> = {
  RECEIVING: 'Receiving',
  QUARANTINE: 'Quarantine',
  WARRANTY: 'Warranty',
};

function drawText(
  doc: Doc,
  label: LabelContent,
  x: number,
  y: number,
  w: number,
) {
  if (label.kind === 'item') {
    const size = fitSize(doc, label.partNo, 'Helvetica-Bold', w, 13, 8);
    let next = line(doc, label.partNo, 'Helvetica-Bold', size, x, y, w);
    next = line(
      doc,
      `${label.brand} · ${label.uom}`,
      'Helvetica',
      8,
      x,
      next,
      w,
    );
    line(doc, label.description, 'Helvetica', 7, x, next, w, 2);
    return;
  }
  const size = fitSize(doc, label.code, 'Helvetica-Bold', w, 18, 9);
  const next = line(doc, label.code, 'Helvetica-Bold', size, x, y, w);
  const kind = label.binKind
    ? ` · ${BIN_KIND_LABEL[label.binKind] ?? label.binKind}`
    : '';
  line(doc, `${label.zone}${kind}`, 'Helvetica', 8, x, next, w);
}

export function renderLabels(
  labels: readonly LabelContent[],
  skip: number,
  g: SheetGeometry = LABEL_SHEET,
): Promise<Buffer> {
  const doc = new PDFDocument({
    size: [mm(g.pageWidthMm), mm(g.pageHeightMm)],
    margin: 0,
    autoFirstPage: false,
    info: { Title: 'Labels' },
  });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const slots = labelSlots(labels.length, skip, g);
  const pad = mm(g.paddingMm);
  const barH = mm(g.barcodeHeightMm);
  let page = -1;
  labels.forEach((label, i) => {
    const slot = slots[i];
    if (!slot) return;
    while (page < slot.page) {
      doc.addPage({ size: [mm(g.pageWidthMm), mm(g.pageHeightMm)], margin: 0 });
      page++;
    }
    const x = mm(slot.xMm) + pad;
    const y = mm(slot.yMm);
    const w = mm(g.cellWidthMm) - pad * 2;
    const bottom = y + mm(g.cellHeightMm) - pad;
    drawText(doc, label, x, y + pad, w);
    doc.font('Courier').fontSize(7);
    const tokenH = doc.currentLineHeight(true);
    const barY = bottom - tokenH - mm(0.6) - barH;
    drawBarcode(doc, label.token, x, barY, w, barH);
    doc.fillColor('black').text(label.token, x, bottom - tokenH, {
      width: w,
      align: 'center',
      lineGap: 0,
    });
  });
  if (page < 0) doc.addPage();
  doc.end();
  return done;
}
