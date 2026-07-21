import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { AppConfig } from '../config/app.config';
import { productImageOptions } from '../common/upload';

@Module({
  imports: [
    MulterModule.registerAsync({
      useFactory: (config: AppConfig) => productImageOptions(config.maxImageBytes),
      inject: [AppConfig],
    }),
  ],
  controllers: [ProductsController],
  providers: [ProductsService],
  exports: [ProductsService],
})
export class ProductsModule {}
