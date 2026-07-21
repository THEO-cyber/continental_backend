import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { Response } from 'express';
import * as path from 'path';
import { SettingsService } from '../settings/settings.service';
import { ApiReceipt } from './receipts.service';

// Continental Automobiles' real letterhead — Kribi, Cameroon. Kept as fixed
// facts (registration numbers, brand list) since they're not settings a
// superadmin would casually edit; phone/email/address still come from
// Admin > Settings so they stay a single source of truth with the client site.
const LETTERHEAD = {
  taxpayerNo: 'P036600194793R',
  rccm: 'RC/KBI/2014/A/50',
};

const ASSETS_DIR = path.join(__dirname, '..', '..', 'assets');
const HEADER_IMAGE = path.join(ASSETS_DIR, 'receipt-header.jpg');
const WATERMARK_IMAGE = path.join(ASSETS_DIR, 'receipt-watermark.jpg');

const NAVY = '#1a2270';
const RED = '#c81e1e';
const DARK = '#1c1c1c';
const MUTED = '#5b6779';
const LINE = '#d7dee8';
const GREEN = '#0f9d3f';

function money(n: number): string {
  // Not toLocaleString('fr-FR'): its thousands separator is a non-breaking
  // space PDFKit's built-in font can't render (shows up as a garbled "/").
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' FCFA';
}

@Injectable()
export class ReceiptPdfService {
  constructor(private readonly settings: SettingsService) {}

  // `inline` (default) lets the browser render the PDF in its own viewer —
  // opening and reading it needs no download step. `download: true` forces
  // the classic save-to-disk prompt instead, for when that's what's wanted.
  async stream(receipt: ApiReceipt, res: Response, download = false): Promise<void> {
    const settings = await this.settings.getAll();
    const doc = new PDFDocument({ size: 'A4', margin: 0 });

    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="${receipt.receipt_number}.pdf"`);
    doc.pipe(res);

    const PAGE_W = 595.28;
    const FOOTER_Y = 797; // A4 height is 841.89pt; bar is 45pt tall — flush with the bottom edge
    const CONTENT_BOTTOM = 775; // last y a row/block may start at before a page break is forced
    const cols = { no: 40, item: 70, qty: 350, price: 410, total: 485 };

    const drawFooter = () => {
      doc.rect(0, FOOTER_Y, PAGE_W, 45).fill(GREEN);
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#ffffff')
        .text(`N° Contr: ${LETTERHEAD.taxpayerNo}   Tel: ${settings.phone}`, 0, FOOTER_Y + 9, { width: PAGE_W, align: 'center' })
        .text(`N° RCCM: ${LETTERHEAD.rccm}   E-mail: ${settings.email}   ${settings.address}`, 0, FOOTER_Y + 24, { width: PAGE_W, align: 'center' });
    };
    const drawWatermark = (top: number, height: number) => {
      doc.save();
      doc.opacity(0.08);
      doc.image(WATERMARK_IMAGE, 90, top, { fit: [415, height], align: 'center', valign: 'center' });
      doc.opacity(1);
      doc.restore();
    };
    // Table header row — repeated at the top of every page that has items on it.
    const drawTableHeader = (headerY: number): number => {
      doc.rect(40, headerY, 535, 24).fill(NAVY);
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#ffffff')
        .text('#', cols.no + 5, headerY + 7)
        .text('Item', cols.item, headerY + 7)
        .text('Qty', cols.qty, headerY + 7, { width: 50, align: 'right' })
        .text('Unit Price', cols.price, headerY + 7, { width: 65, align: 'right' })
        .text('Total', cols.total, headerY + 7, { width: 65, align: 'right' });
      return headerY + 24;
    };
    // Every page after the first is a continuation page: no room for the full
    // banner image, so it gets a compact text header + running watermark instead.
    doc.on('pageAdded', () => {
      doc.font('Helvetica-Bold').fontSize(12).fillColor(NAVY)
        .text('CONTINENTAL AUTOMOBILES', 20, 24, { width: 555, align: 'center' });
      doc.font('Helvetica').fontSize(9).fillColor(MUTED)
        .text(`Receipt ${receipt.receipt_number} — continued`, 20, 42, { width: 555, align: 'center' });
      doc.moveTo(20, 58).lineTo(575, 58).strokeColor(LINE).lineWidth(1).stroke();
      drawWatermark(75, 660);
      drawFooter();
    });

    // ---- letterhead: real banner image (logo, title, brands — all baked in) ----
    doc.image(HEADER_IMAGE, 20, 14, { fit: [555, 130], align: 'center', valign: 'center' });
    drawWatermark(165, 580);
    drawFooter();

    // ---- receipt meta ----
    doc.font('Helvetica-Bold').fontSize(18).fillColor(NAVY).text('RECEIPT / REÇU', 20, 162, { width: 555, align: 'center' });
    doc.font('Helvetica').fontSize(10).fillColor(MUTED)
      .text(`No: ${receipt.receipt_number}    Date: ${receipt.created_at.slice(0, 10)}`, 20, 186, { width: 555, align: 'center' });

    // ---- bill to ----
    const buyerLabel = receipt.buyer_type === 'company' ? 'Company / Société' : 'Individual / Particulier';
    doc.font('Helvetica-Bold').fontSize(9).fillColor(MUTED).text('BILL TO / CLIENT', 40, 216);
    doc.font('Helvetica-Bold').fontSize(13).fillColor(NAVY).text(receipt.buyer_name, 40, 230);
    doc.font('Helvetica').fontSize(9).fillColor(MUTED);
    let y = 247;
    doc.text(`Type: ${buyerLabel}`, 40, y); y += 13;
    if (receipt.buyer_phone) { doc.text(`Phone: ${receipt.buyer_phone}`, 40, y); y += 13; }
    if (receipt.buyer_address) { doc.text(`Address: ${receipt.buyer_address}`, 40, y); y += 13; }

    // ---- items table (paginates automatically once rows near the footer) ----
    const tableY = Math.max(y + 16, 306);
    let rowY = drawTableHeader(tableY);
    doc.font('Helvetica').fontSize(9);
    const rowHeight = 22;
    receipt.items.forEach((item, i) => {
      if (rowY + rowHeight > CONTENT_BOTTOM) {
        doc.addPage();
        rowY = drawTableHeader(70);
        doc.font('Helvetica').fontSize(9);
      }
      if (i % 2 === 1) doc.rect(40, rowY, 535, rowHeight).fill('#f6f8fb');
      doc.fillColor(DARK)
        .text(String(i + 1), cols.no + 5, rowY + 6)
        .text(item.product_name + (item.sku ? `  (${item.sku})` : ''), cols.item, rowY + 6, { width: 270 })
        .text(String(item.quantity), cols.qty, rowY + 6, { width: 50, align: 'right' })
        .text(money(item.unit_price), cols.price, rowY + 6, { width: 65, align: 'right' })
        .text(money(item.total), cols.total, rowY + 6, { width: 65, align: 'right' });
      rowY += rowHeight;
    });
    doc.moveTo(40, rowY).lineTo(575, rowY).strokeColor(LINE).stroke();
    rowY += 18;

    // ---- total ----
    if (rowY + 24 > CONTENT_BOTTOM) { doc.addPage(); rowY = 70; }
    doc.font('Helvetica-Bold').fontSize(12).fillColor(NAVY)
      .text('TOTAL', 300, rowY, { width: 100, align: 'right' })
      .fillColor(RED)
      .text(money(receipt.total), 405, rowY, { width: 170, align: 'right' });
    rowY += 24;

    // ---- notes ----
    if (receipt.notes) {
      if (rowY + 45 > CONTENT_BOTTOM) { doc.addPage(); rowY = 70; }
      doc.font('Helvetica-Bold').fontSize(9).fillColor(MUTED).text('NOTES', 40, rowY);
      doc.font('Helvetica').fontSize(9).fillColor(DARK).text(receipt.notes, 40, rowY + 14, { width: 535 });
      rowY += 45;
    }

    if (rowY + 30 > CONTENT_BOTTOM) { doc.addPage(); rowY = 70; }
    doc.font('Helvetica-Oblique').fontSize(9).fillColor(MUTED)
      .text(`Issued by ${receipt.issued_by} thank you for your business.`, 40, rowY + 16, { width: 535, align: 'center' });
    rowY += 40;

    // ---- signatures: seller (superadmin) and buyer (company or individual) ----
    const SIG_BLOCK_H = 76;
    if (rowY + SIG_BLOCK_H > CONTENT_BOTTOM) { doc.addPage(); rowY = 70; }
    const sigLineY = rowY + 34; // blank room above the line to physically sign
    const leftX = 60, rightX = 335, lineW = 200;
    doc.moveTo(leftX, sigLineY).lineTo(leftX + lineW, sigLineY).strokeColor(LINE).lineWidth(1).stroke();
    doc.moveTo(rightX, sigLineY).lineTo(rightX + lineW, sigLineY).strokeColor(LINE).lineWidth(1).stroke();
    doc.font('Helvetica-Bold').fontSize(9).fillColor(DARK)
      .text(receipt.issued_by, leftX, sigLineY + 6, { width: lineW })
      .text(receipt.buyer_name, rightX, sigLineY + 6, { width: lineW });
    doc.font('Helvetica').fontSize(8).fillColor(MUTED)
      .text('Authorized Signature / Signature Autorisée', leftX, sigLineY + 20, { width: lineW })
      .text(`${buyerLabel} Signature`, rightX, sigLineY + 20, { width: lineW });

    doc.end();
  }
}
