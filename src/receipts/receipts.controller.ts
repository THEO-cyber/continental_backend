import { Body, Controller, Get, Param, Post, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { ReceiptsService } from './receipts.service';
import { ReceiptPdfService } from './receipt-pdf.service';
import { CreateReceiptDto } from './dto/receipt.dto';
import { AuthUser, CurrentUser, Roles } from '../common/decorators';

@Controller('api/admin/receipts')
@Roles('superadmin')
export class ReceiptsController {
  constructor(
    private readonly receipts: ReceiptsService,
    private readonly pdf: ReceiptPdfService,
  ) {}

  @Get()
  list(@Query('from') from?: string, @Query('to') to?: string, @Query('search') search?: string) {
    return this.receipts.list({ from, to, search });
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateReceiptDto) {
    return this.receipts.create(user, dto);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.receipts.findOne(id);
  }

  @Get(':id/pdf')
  async downloadPdf(
    @Param('id') id: string,
    @Res() res: Response,
    @Query('download') download?: string,
  ) {
    const receipt = await this.receipts.findOne(id);
    await this.pdf.stream(receipt, res, download === '1');
  }
}
