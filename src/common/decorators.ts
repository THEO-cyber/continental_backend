import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';
/** Marks a route as reachable without a JWT (client site, login, SEO pages). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const ROLES_KEY = 'roles';
/** Restricts a route to the given roles ('superadmin' | 'worker'). */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

export interface AuthUser {
  id: string;
  username: string;
  name: string;
  role: string;
  active: number;
}

/** Injects the authenticated user attached by JwtAuthGuard. */
export const CurrentUser = createParamDecorator((data: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user;
});
