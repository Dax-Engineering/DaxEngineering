import PDFDocument from 'pdfkit';

/** DAX's own copy lists DAX part numbers and bins; the customer copy lists the customer's part numbers only. */
export type AodCopy = 'dax' | 'customer';

export interface AodPrint {
  number: string | null;
  typeLabel: string;
  date: Date;
  mrnNumber: string | null;
  department: string;
  customer: string | null;
  jobNumber: string | null;
  deliverTo: string | null;
  vehicleNo: string | null;
  notes: string | null;
  issuedBy: string | null;
  lines: {
    partNo: string;
    /** The MRN line's number when an older number of its family is supplied. */
    requestedPartNo: string | null;
    description: string;
    bin: string | null;
    qty: string;
    uom: string;
    customerPartNo: string | null;
    /** The bundle this part belongs to; null for a loose part. */
    bundleId: string | null;
  }[];
  bundles: {
    id: string;
    name: string;
    sets: number;
    customerPartNo: string | null;
  }[];
}

const PAGE = { width: 595.28, height: 841.89, margin: 40 };
type Column = { title: string; width: number; align: 'left' | 'right' };
type Line = AodPrint['lines'][number];

const COPIES: Record<
  AodCopy,
  {
    label: string;
    columns: Column[];
    cells: (line: Line, i: number) => string[];
    heading: (bundle: Bundle, i: number) => string[];
  }
> = {
  dax: {
    label: 'DAX copy',
    columns: [
      { title: '#', width: 24, align: 'left' },
      { title: 'Part no', width: 110, align: 'left' },
      { title: 'Description', width: 210, align: 'left' },
      { title: 'Bin', width: 75, align: 'left' },
      { title: 'Qty', width: 55, align: 'right' },
      { title: 'Unit', width: 41, align: 'left' },
    ],
    cells: (l, i) => [
      String(i + 1),
      l.requestedPartNo
        ? `${l.requestedPartNo} (supplied as ${l.partNo})`
        : l.partNo,
      l.description,
      l.bin ?? '-',
      l.qty,
      l.uom,
    ],
    heading: (b, i) => [String(i + 1), '', b.name, '', String(b.sets), 'SET'],
  },
  customer: {
    label: 'Customer copy',
    columns: [
      { title: '#', width: 24, align: 'left' },
      { title: 'Your part no', width: 150, align: 'left' },
      { title: 'Description', width: 245, align: 'left' },
      { title: 'Qty', width: 55, align: 'right' },
      { title: 'Unit', width: 41, align: 'left' },
    ],
    cells: (l, i) => [
      String(i + 1),
      l.customerPartNo ?? '-',
      l.description,
      l.qty,
      l.uom,
    ],
    heading: (b, i) => [
      String(i + 1),
      b.customerPartNo ?? '-',
      b.name,
      String(b.sets),
      'SET',
    ],
  },
};

type Bundle = AodPrint['bundles'][number];
export interface PrintRow {
  cells: string[];
  /** heading: a bundle; part: one of its parts (indented); line: a loose part. */
  kind: 'heading' | 'part' | 'line';
}

/** Rows in print order: each bundle as a numbered heading with its parts under it, then loose parts. */
export function aodRows(copy: AodCopy, data: AodPrint): PrintRow[] {
  const spec = COPIES[copy];
  const rows: PrintRow[] = [];
  let n = 0;
  for (const b of data.bundles) {
    rows.push({ cells: spec.heading(b, n++), kind: 'heading' });
    for (const l of data.lines.filter((x) => x.bundleId === b.id)) {
      const cells = spec.cells(l, 0);
      cells[0] = '';
      if (copy === 'customer') cells[1] = '';
      cells[2] = `·  ${cells[2] ?? ''}`;
      rows.push({ cells, kind: 'part' });
    }
  }
  for (const l of data.lines.filter((x) => !x.bundleId)) {
    rows.push({ cells: spec.cells(l, n++), kind: 'line' });
  }
  return rows;
}

export function aodCopyCells(copy: AodCopy, data: AodPrint): string[][] {
  return aodRows(copy, data).map((r) => r.cells);
}

export function colomboTime(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Colombo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

export function renderAod(
  data: AodPrint,
  copy: AodCopy = 'dax',
): Promise<Buffer> {
  const { columns: COLUMNS, label } = COPIES[copy];
  const doc = new PDFDocument({
    size: 'A4',
    margin: PAGE.margin,
    info: { Title: data.number ? `AOD ${data.number}` : 'AOD' },
  });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const left = PAGE.margin;
  const right = PAGE.width - PAGE.margin;
  const width = right - left;

  doc.font('Helvetica-Bold').fontSize(20).text('DAX Engineering', left, 40);
  doc
    .font('Helvetica-Bold')
    .fontSize(13)
    .text('ADVICE OF DISPATCH', left, 44, { width, align: 'right' });
  doc
    .font('Helvetica')
    .fontSize(10)
    .text(data.number ?? 'Not issued yet', left, 62, { width, align: 'right' })
    .text(`${data.typeLabel} · ${label}`, left, 76, { width, align: 'right' });
  doc.moveTo(left, 96).lineTo(right, 96).lineWidth(1).stroke();

  const facts: [string, string | null][] = [
    ['Date', colomboTime(data.date)],
    ['MRN', data.mrnNumber],
    ['Department', data.department],
    ...(data.customer !== null
      ? [['Customer', data.customer] as [string, string]]
      : []),
    ['Job number', data.jobNumber],
    ['Deliver to', data.deliverTo],
    ['Vehicle', data.vehicleNo],
  ];
  let y = 108;
  const half = width / 2;
  facts.forEach(([label, value], i) => {
    const x = left + (i % 2) * half;
    if (i > 0 && i % 2 === 0) y += 18;
    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .text(`${label}:`, x, y, { width: 80 });
    doc
      .font('Helvetica')
      .fontSize(9)
      .text(value ?? '-', x + 82, y, {
        width: half - 90,
        lineBreak: false,
        ellipsis: true,
      });
  });
  y += 28;
  if (data.notes) {
    doc.font('Helvetica-Bold').fontSize(9).text('Notes:', left, y);
    doc
      .font('Helvetica')
      .fontSize(9)
      .text(data.notes, left + 82, y, { width: width - 82 });
    y = doc.y + 10;
  }

  const drawHeader = (top: number) => {
    doc.rect(left, top, width, 18).fill('#eeeeee').fillColor('#000000');
    let x = left;
    for (const col of COLUMNS) {
      doc
        .font('Helvetica-Bold')
        .fontSize(9)
        .text(col.title, x + 4, top + 5, {
          width: col.width - 8,
          align: col.align,
        });
      x += col.width;
    }
    return top + 18;
  };

  const signatureHeight = 120;
  y = drawHeader(y);
  aodRows(copy, data).forEach(({ cells, kind }) => {
    doc.font(kind === 'heading' ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
    const rowHeight =
      Math.max(
        ...cells.map((c, j) =>
          doc.heightOfString(c, { width: (COLUMNS[j]?.width ?? 40) - 8 }),
        ),
      ) + 8;
    if (y + rowHeight > PAGE.height - PAGE.margin - 20) {
      doc.addPage();
      y = drawHeader(PAGE.margin);
    }
    if (kind === 'heading') {
      doc.rect(left, y, width, rowHeight).fill('#f2f2f2').fillColor('#000000');
    }
    let x = left;
    cells.forEach((cell, j) => {
      const col = COLUMNS[j];
      if (!col) return;
      const indent = kind === 'part' && j === 2 ? 10 : 0;
      doc.text(cell, x + 4 + indent, y + 4, {
        width: col.width - 8 - indent,
        align: col.align,
      });
      x += col.width;
    });
    doc
      .moveTo(left, y + rowHeight)
      .lineTo(right, y + rowHeight)
      .lineWidth(0.5)
      .strokeColor('#bbbbbb')
      .stroke()
      .strokeColor('#000000');
    y += rowHeight;
  });

  if (y + signatureHeight + 20 > PAGE.height - PAGE.margin) {
    doc.addPage();
    y = PAGE.margin;
  } else {
    y += 24;
  }
  const boxWidth = (width - 20) / 2;
  (['Issued by', 'Received by'] as const).forEach((title, i) => {
    const x = left + i * (boxWidth + 20);
    doc.rect(x, y, boxWidth, signatureHeight).lineWidth(1).stroke();
    doc
      .font('Helvetica-Bold')
      .fontSize(10)
      .text(title, x + 8, y + 8);
    const rows: [string, string][] = [
      ['Name', i === 0 ? (data.issuedBy ?? '') : ''],
      ['Signature', ''],
      ['Date', ''],
    ];
    rows.forEach(([label, value], r) => {
      const rowY = y + 34 + r * 28;
      doc
        .font('Helvetica')
        .fontSize(9)
        .text(`${label}:`, x + 8, rowY);
      if (value) doc.text(value, x + 70, rowY, { width: boxWidth - 78 });
      doc
        .moveTo(x + 68, rowY + 12)
        .lineTo(x + boxWidth - 8, rowY + 12)
        .lineWidth(0.5)
        .stroke();
    });
  });

  doc.end();
  return done;
}
