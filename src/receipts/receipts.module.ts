import { Module } from '@nestjs/common';
import { ReceiptsController } from './receipts.controller';
import { ReceiptsService } from './receipts.service';
import { ReceiptPdfService } from './receipt-pdf.service';

@Module({
  controllers: [ReceiptsController],
  providers: [ReceiptsService, ReceiptPdfService],
})
export class ReceiptsModule {}
