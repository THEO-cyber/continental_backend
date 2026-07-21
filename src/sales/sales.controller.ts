import { Controller, Delete, Get, Param, ParseIntPipe, Post, Query, Res, Body } from '@nestjs/common';
import { Response } from 'express';
import { SalesService } from './sales.service';
import { RecordSaleDto } from './dto/sale.dto';
import { AuthUser, CurrentUser, Roles } from '../common/decorators';

function sendCsv(res: Response, filename: string, csv: string): void {
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
}

@Controller('api/sales')
export class SalesController {
  constructor(private readonly sales: SalesService) {}

  @Post()
  record(@CurrentUser() user: AuthUser, @Body() dto: RecordSaleDto) {
    return this.sales.record(user, dto.product_id, dto.quantity, dto.unit_price);
  }

  @Get('mine/today')
  mineToday(@CurrentUser() user: AuthUser) {
    return this.sales.mineToday(user);
  }

  @Get('daily')
  @Roles('superadmin')
  daily(@Query('date') date?: string) {
    return this.sales.daily(date);
  }

  @Get('summary')
  @Roles('superadmin')
  summary(@Query('days') days?: string) {
    return this.sales.summary(days);
  }

  // Full business-records ledger, downloadable as CSV — optionally scoped to a
  // date range and/or one worker.
  @Get('export')
  @Roles('superadmin')
  async exportLedger(
    @Res() res: Response,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('workerId') workerId?: string,
  ) {
    const { filename, csv } = await this.sales.exportLedgerCsv({ from, to, workerId });
    sendCsv(res, filename, csv);
  }

  // One worker's sales for a day / month / year — never buried in an all-worker report.
  @Get('worker/:workerId')
  @Roles('superadmin')
  workerReport(
    @Param('workerId', ParseIntPipe) workerId: number,
    @Query('period') period?: string,
    @Query('date') date?: string,
  ) {
    return this.sales.workerReport(workerId, period, date);
  }

  @Get('worker/:workerId/export')
  @Roles('superadmin')
  async workerExport(
    @Res() res: Response,
    @Param('workerId', ParseIntPipe) workerId: number,
    @Query('period') period?: string,
    @Query('date') date?: string,
  ) {
    const { filename, csv } = await this.sales.workerExportCsv(workerId, period, date);
    sendCsv(res, filename, csv);
  }

  @Delete(':id')
  @Roles('superadmin')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.sales.remove(id);
  }
}
