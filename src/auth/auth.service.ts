import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { hashPassword, verifyPassword } from '../common/crypto.util';
import { AuthUser } from '../common/decorators';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async login(username: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { username: username.trim() } });
    if (!user || !user.active || !verifyPassword(password, user.passwordHash)) {
      throw new UnauthorizedException('Invalid username or password');
    }
    return {
      token: await this.jwt.signAsync({ sub: user.id, role: user.role }),
      user: { id: user.id, username: user.username, name: user.name, role: user.role },
    };
  }

  async changePassword(actor: AuthUser, current: string, next: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: actor.id } });
    if (!user || !verifyPassword(current, user.passwordHash)) {
      throw new UnauthorizedException('Current password is incorrect');
    }
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: hashPassword(next) },
    });
  }
}
