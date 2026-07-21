import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { BranchesService } from './branches.service';
import { CreateBranchDto } from './dto/branch.dto';
import { Roles } from '../common/decorators';

@Controller('api/admin/branches')
export class BranchesController {
  constructor(private readonly branches: BranchesService) {}

  // Both roles can list — workers need this to search other branches' stock.
  @Get()
  list() {
    return this.branches.list();
  }

  @Post()
  @Roles('superadmin')
  create(@Body() dto: CreateBranchDto) {
    return this.branches.create(dto);
  }

  @Delete(':id')
  @Roles('superadmin')
  remove(@Param('id') id: string) {
    return this.branches.remove(id);
  }
}
