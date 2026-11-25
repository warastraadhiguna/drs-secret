// PDF invoice A4 (untuk dikirim lewat WA) — dibuat di browser dgn jsPDF,
// isi & urutan sama dgn components/InvoiceDocument.jsx.
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { rupiah, qty, longDate, groupInvoiceLines, componentsText } from './format.js';

function loadImageSize(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

export async function buildInvoicePdf(order) {
  const s = order.invoiceSettings || {};
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 15;
  const right = pageW - margin;

  // Cap LUNAS/BATAL digambar PERTAMA dgn warna pudar — isi invoice ditulis
  // di atasnya, jadi tetap terbaca.
  const stamp = order.status === 'voided' ? 'BATAL' : order.paymentStatus === 'paid' ? 'LUNAS' : null;
  if (stamp) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(64);
    if (stamp === 'BATAL') doc.setTextColor(250, 200, 200);
    else doc.setTextColor(200, 235, 210);
    doc.text(stamp, pageW / 2, 150, { align: 'center', angle: 20 });
    doc.setTextColor(0);
  }

  // --- Kop ---
  let textX = margin;
  if (s.logo) {
    const size = await loadImageSize(s.logo);
    if (size) {
      const h = 20;
      const w = Math.min((size.w / size.h) * h, 45);
      const format = s.logo.startsWith('data:image/png') ? 'PNG' : 'JPEG';
      try {
        doc.addImage(s.logo, format, margin, 12, w, h);
        textX = margin + w + 4;
      } catch {
        // logo rusak — lanjut tanpa logo
      }
    }
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(s.storeName || '', textX, 18);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  let headY = 23;
  for (const line of [s.storeAddress, s.storePhone].filter(Boolean)) {
    doc.text(String(line), textX, headY);
    headY += 4.5;
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.text('INVOICE', right, 18, { align: 'right' });
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  const meta = [['No.', String(order.invoiceNumber)], ['Tanggal', longDate(order.invoiceDate)]];
  if (order.dueDate) meta.push(['Jatuh tempo', longDate(order.dueDate)]);
  let metaY = 25;
  for (const [k, v] of meta) {
    doc.text(k, right - 60, metaY);
    doc.setFont('helvetica', 'bold');
    doc.text(v, right, metaY, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    metaY += 5;
  }

  let y = Math.max(headY, metaY, 34) + 4;
  doc.setDrawColor(180);
  doc.line(margin, y, right, y);
  y += 6;

  // --- Kepada ---
  doc.setFontSize(9);
  doc.setTextColor(110);
  doc.text('Kepada Yth.', margin, y);
  doc.setTextColor(0);
  y += 5;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(`${order.customerName}${order.customerCity ? ` — ${order.customerCity}` : ''}`, margin, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  y += 5;
  const toLines = [];
  if (order.customerPhone) toLines.push(order.customerPhone);
  if (order.shippingAddress) toLines.push(...doc.splitTextToSize(order.shippingAddress, 110));
  for (const line of toLines) {
    doc.text(line, margin, y);
    y += 4.5;
  }
  y += 3;

  // --- Barang ---
  const body = groupInvoiceLines(order.items).map((it, idx) => [
    String(idx + 1),
    `${it.productName}${it.isBonus ? '  (FREE)' : ''}${it.isIndent ? '  (INDENT)' : ''}${it.kind === 'bundle' ? `\nIsi: ${componentsText(it.components)}` : ''}${Number(it.discountAmount) > 0 ? `\nDiskon ${rupiah(it.discountAmount)}` : ''}`,
    `${qty(it.quantity)} ${it.unitName}`,
    it.isBonus ? '-' : rupiah(it.sellingPrice),
    it.isBonus ? 'GRATIS' : rupiah(it.subtotal),
  ]);
  autoTable(doc, {
    startY: y,
    head: [['No', 'Nama Barang', 'Qty', 'Harga', 'Jumlah']],
    body,
    theme: 'grid',
    margin: { left: margin, right: margin },
    styles: { fontSize: 9.5, cellPadding: 2.2 },
    headStyles: { fillColor: [55, 65, 81], textColor: 255 },
    columnStyles: {
      0: { cellWidth: 10 },
      2: { cellWidth: 24, halign: 'right' },
      3: { cellWidth: 30, halign: 'right' },
      4: { cellWidth: 32, halign: 'right' },
    },
    didParseCell: (data) => {
      if (data.section === 'head' && data.column.index >= 2) data.cell.styles.halign = 'right';
    },
  });
  y = doc.lastAutoTable.finalY + 6;

  // --- Total ---
  const totals = [];
  const hasDiscount = Number(order.discountTotal) > 0;
  const hasPpn = Number(order.ppnAmount) > 0;
  const hasShipping = Number(order.shippingFee) > 0;
  if (hasDiscount || hasPpn || hasShipping) totals.push(['Subtotal', rupiah(order.subtotal)]);
  if (hasDiscount) totals.push(['Diskon', `-${rupiah(order.discountTotal)}`]);
  if (hasPpn) {
    totals.push([
      `PPN ${Number(order.ppnRate)}%${order.ppnMode === 'included' ? ' (termasuk)' : ''}`,
      order.ppnMode === 'included' ? rupiah(order.ppnAmount) : `+${rupiah(order.ppnAmount)}`,
    ]);
  }
  if (hasShipping) totals.push([`Ongkir${order.shippingMethod ? ` (${order.shippingMethod})` : ''}`, rupiah(order.shippingFee)]);
  totals.push(['TOTAL', rupiah(order.totalDue), true]);
  if (Number(order.amountPaid) > 0 && Number(order.outstanding) > 0) {
    totals.push(['Sudah dibayar', rupiah(order.amountPaid)]);
    totals.push(['SISA TAGIHAN', rupiah(order.outstanding), true]);
  }

  const notesTop = y;
  doc.setFontSize(10);
  for (const [label, value, bold] of totals) {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(bold ? 11.5 : 10);
    doc.text(label, right - 75, y);
    doc.text(value, right, y, { align: 'right' });
    y += bold ? 6.5 : 5.5;
  }
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  if (order.notes) {
    const lines = doc.splitTextToSize(order.notes, 90);
    doc.text(lines, margin, notesTop);
    y = Math.max(y, notesTop + lines.length * 5);
  }

  // --- Rekening & tanda tangan ---
  y += 8;
  const footTop = y;
  if (s.bankInfo) {
    doc.setFontSize(9);
    doc.setTextColor(110);
    doc.text('Pembayaran via transfer ke:', margin, y);
    doc.setTextColor(0);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.text(doc.splitTextToSize(s.bankInfo, 95), margin, y + 5.5);
    doc.setFont('helvetica', 'normal');
  }
  doc.setFontSize(10);
  doc.text('Hormat kami,', right - 30, footTop, { align: 'center' });
  doc.line(right - 52, footTop + 24, right - 8, footTop + 24);
  doc.text(s.signerName || '', right - 30, footTop + 29, { align: 'center' });
  y = footTop + 38;

  if (s.footerNote) {
    doc.setFontSize(9);
    doc.setTextColor(110);
    doc.text(doc.splitTextToSize(s.footerNote, pageW - margin * 2), pageW / 2, y, { align: 'center' });
    doc.setTextColor(0);
  }

  return doc;
}

export async function downloadInvoicePdf(order) {
  const doc = await buildInvoicePdf(order);
  const safeName = (order.customerName || '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
  doc.save(`Invoice-${order.invoiceNumber}${safeName ? `-${safeName}` : ''}.pdf`);
}
