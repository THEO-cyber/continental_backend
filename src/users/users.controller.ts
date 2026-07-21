import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateWorkerDto, PatchWorkerDto } from './dto/worker.dto';
import { Roles } from '../common/decorators';

@Controller('api/admin/workers')
@Roles('superadmin')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list() {
    return this.users.listWorkers();
  }

  @Post()
  create(@Body() dto: CreateWorkerDto) {
    return this.users.createWorker(dto);
  }

  @Patch(':id')
  patch(@Param('id') id: string, @Body() dto: PatchWorkerDto) {
    return this.users.patchWorker(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.users.deleteWorker(id);
  }
}
