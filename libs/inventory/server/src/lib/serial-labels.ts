import PDFDocument from 'pdfkit';
import {
  code128Bars,
  code128Modules,
  SERIAL_LABELS_PER_SHEET,
} from '@dax/inventory-contract';
import { mm } from './labels';

/** A4 sheet of 3 × 10 labels, 70 × 29.7 mm. */
export const SERIAL_SHEET = {
  pageWidthMm: 210,
  pageHeightMm: 297,
  columns: 3,
  rows: 10,
  cellWidthMm: 70,
  cellHeightMm: 29.7,
  paddingXMm: 3,
  paddingTopMm: 2,
  barcodeHeightMm: 10,
  quietModules: 10,
} as const;

export interface SerialLabel {
  serial: string;
  partNo: string;
  brand: string;
  description: string;
  /** e.g. "GRN/FOR/26/0041 · 2 of 3" */
  footer: string;
  damaged: boolean;
}

/** The serial in groups of four, for people to read. */
export function groupSerial(serial: string): string {
  return serial.replace(/(.{4})(?=.)/g, '$1 ');
}

export function serialSlot(index: number) {
  const g = SERIAL_SHEET;
  const within = index % SERIAL_LABELS_PER_SHEET;
  const row = Math.floor(within / g.columns);
  const column = within % g.columns;
  return {
    page: Math.floor(index / SERIAL_LABELS_PER_SHEET),
    xMm: column * g.cellWidthMm,
    yMm: row * g.cellHeightMm,
  };
}

type Doc = PDFKit.PDFDocument;

function textLine(
  doc: Doc,
  text: string,
  font: string,
  size: number,
  x: number,
  y: number,
  width: number,
  align: 'left' | 'center' | 'right' = 'left',
): number {
  doc.font(font).fontSize(size).fillColor('black');
  const height = doc.currentLineHeight(true);
  doc.text(text, x, y, { width, height, ellipsis: true, lineGap: 0, align });
  return y + height;
}

function drawBarcode(
  doc: Doc,
  serial: string,
  x: number,
  y: number,
  w: number,
) {
  const g = SERIAL_SHEET;
  const modules = code128Modules(serial) + g.quietModules * 2;
  const module = w / modules;
  const height = mm(g.barcodeHeightMm);
  for (const [start, width] of code128Bars(serial)) {
    doc.rect(x + (start + g.quietModules) * module, y, width * module, height);
  }
  doc.fillColor('black').fill();
  return y + height;
}

function drawLabel(doc: Doc, label: SerialLabel, xMm: number, yMm: number) {
  const g = SERIAL_SHEET;
  const x = mm(xMm + g.paddingXMm);
  const w = mm(g.cellWidthMm - g.paddingXMm * 2);
  let y = mm(yMm + g.paddingTopMm);
  y = textLine(
    doc,
    `${label.partNo} · ${label.brand}`,
    'Helvetica-Bold',
    8,
    x,
    y,
    w,
  );
  y = textLine(doc, label.description, 'Helvetica', 6.5, x, y, w);
  y = drawBarcode(doc, label.serial, x, y + mm(0.6), w);
  y = textLine(
    doc,
    groupSerial(label.serial),
    'Courier-Bold',
    8.5,
    x,
    y + mm(0.4),
    w,
    'center',
  );
  textLine(
    doc,
    label.damaged ? `DAMAGED · ${label.footer}` : label.footer,
    label.damaged ? 'Helvetica-Bold' : 'Helvetica',
    5.5,
    x,
    y,
    w,
    'center',
  );
}

export function renderSerialLabels(
  labels: readonly SerialLabel[],
  skip: number,
): Promise<Buffer> {
  const g = SERIAL_SHEET;
  const size: [number, number] = [mm(g.pageWidthMm), mm(g.pageHeightMm)];
  const doc = new PDFDocument({
    size,
    margin: 0,
    autoFirstPage: false,
    info: { Title: 'Serial labels' },
  });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  let page = -1;
  labels.forEach((label, i) => {
    const slot = serialSlot(skip + i);
    while (page < slot.page) {
      doc.addPage({ size, margin: 0 });
      page++;
    }
    drawLabel(doc, label, slot.xMm, slot.yMm);
  });
  if (labels.length === 0) doc.addPage({ size, margin: 0 });
  doc.end();
  return done;
}
