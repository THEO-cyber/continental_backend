import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { ConfigModule } from './config/config.module';
import { PrismaModule } from './prisma/prisma.module';
import { RealtimeModule } from './realtime/realtime.module';
import { AuthModule } from './auth/auth.module';
import { BranchesModule } from './branches/branches.module';
import { CategoriesModule } from './categories/categories.module';
import { UsersModule } from './users/users.module';
import { ProductsModule } from './products/products.module';
import { SalesModule } from './sales/sales.module';
import { SettingsModule } from './settings/settings.module';
import { PublicModule } from './public/public.module';
import { ReceiptsModule } from './receipts/receipts.module';
import { RenderModule } from './render/render.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { HttpExceptionsFilter } from './common/filters/http-exceptions.filter';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    RealtimeModule,
    ThrottlerModule.forRoot([{ ttl: 15 * 60 * 1000, limit: 10 }]),
    AuthModule,
    BranchesModule,
    CategoriesModule,
    UsersModule,
    ProductsModule,
    SalesModule,
    SettingsModule,
    PublicModule,
    ReceiptsModule,
    RenderModule,
  ],
  providers: [
    // Every route requires a valid JWT unless marked @Public();
    // @Roles() then narrows access per endpoint.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_FILTER, useClass: HttpExceptionsFilter },
  ],
})
export class AppModule {}
