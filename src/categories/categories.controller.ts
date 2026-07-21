import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto } from './dto/category.dto';
import { Roles } from '../common/decorators';

@Controller('api/admin/categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  // Both roles can list — workers need this for the add-product category picker.
  @Get()
  list() {
    return this.categories.list();
  }

  @Post()
  @Roles('superadmin')
  create(@Body() dto: CreateCategoryDto) {
    return this.categories.create(dto);
  }

  @Delete(':id')
  @Roles('superadmin')
  remove(@Param('id') id: string) {
    return this.categories.remove(id);
  }
}
