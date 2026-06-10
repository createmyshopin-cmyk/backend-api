import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  GoneException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { LoginDto } from './dto/auth.dto';
import { UsersService, toPublicProfile } from '../users/users.service';
import admin from './firebase-admin';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { AdminUsersService } from './admin-users.service';
import { AdminAuditService } from '../admin/admin-audit.service';
import type { AdminRequestUser } from './admin-user.types';

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('91') && digits.length >= 12) {
    return `+${digits}`;
  }
  if (digits.length === 10) {
    return `+91${digits}`;
  }
  if (phone.trim().startsWith('+')) {
    return `+${digits}`;
  }
  return phone.trim();
}

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly adminUsersService: AdminUsersService,
    private readonly audit: AdminAuditService,
  ) {}

  private sessionTtlMs(): number {
    const raw = process.env.ADMIN_SESSION_TTL_MS ?? String(7 * 24 * 60 * 60 * 1000);
    return Number(raw);
  }

  private signAdminToken(admin: { id: string; role: string }, sessionId: string): string {
    return this.jwtService.sign({
      sub: admin.id,
      userId: admin.id,
      role: admin.role,
      sid: sessionId,
      type: 'admin',
    });
  }

  private signAppToken(userId: string): string {
    return this.jwtService.sign({ userId, sub: userId });
  }

  async login(
    loginDto: LoginDto,
    ctx?: { ip?: string; userAgent?: string },
  ) {
    const email = loginDto.email.trim().toLowerCase();
    const adminUser = await this.adminUsersService.findByEmail(email);

    if (!adminUser || adminUser.status !== 'active') {
      await this.audit.record({
        actorType: 'admin',
        actorEmail: email,
        action: 'admin_login_failure',
        category: 'auth',
        outcome: 'denied',
        resourceType: 'admin_user',
        resourceId: email,
        ipAddress: ctx?.ip,
        userAgent: ctx?.userAgent,
        retentionClass: 'security',
        details: { reason: 'invalid_credentials_or_inactive' },
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    const valid = await this.adminUsersService.verifyPassword(adminUser, loginDto.password);
    if (!valid) {
      await this.audit.record({
        actorType: 'admin',
        actorId: adminUser.id,
        actorEmail: adminUser.email,
        actorRole: adminUser.role,
        action: 'admin_login_failure',
        category: 'auth',
        outcome: 'denied',
        resourceType: 'admin_user',
        resourceId: adminUser.id,
        ipAddress: ctx?.ip,
        userAgent: ctx?.userAgent,
        retentionClass: 'security',
        details: { reason: 'invalid_password' },
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    const expiresAt = new Date(Date.now() + this.sessionTtlMs());
    const session = await this.adminUsersService.createSession(
      adminUser.id,
      adminUser.role,
      expiresAt,
      ctx?.ip,
      ctx?.userAgent,
    );
    await this.adminUsersService.touchLastLogin(adminUser.id);

    await this.audit.record({
      actorType: 'admin',
      actorId: adminUser.id,
      actorEmail: adminUser.email,
      actorRole: adminUser.role,
      action: 'admin_login_success',
      category: 'auth',
      outcome: 'success',
      resourceType: 'admin_session',
      resourceId: session.id,
      ipAddress: ctx?.ip,
      userAgent: ctx?.userAgent,
      retentionClass: 'security',
    });

    return {
      accessToken: this.signAdminToken(adminUser, session.id),
      user: {
        id: adminUser.id,
        name: adminUser.name,
        email: adminUser.email,
        role: adminUser.role,
      },
    };
  }

  register(): never {
    throw new GoneException('Admin self-registration has been removed. Use invite-only onboarding.');
  }

  async acceptInvite(
    token: string,
    password: string,
    name?: string,
    ctx?: { ip?: string; userAgent?: string },
  ) {
    const adminUser = await this.adminUsersService.acceptInvite(token, password, name);

    const expiresAt = new Date(Date.now() + this.sessionTtlMs());
    const session = await this.adminUsersService.createSession(
      adminUser.id,
      adminUser.role,
      expiresAt,
      ctx?.ip,
      ctx?.userAgent,
    );

    await this.audit.record({
      actorType: 'admin',
      actorId: adminUser.id,
      actorEmail: adminUser.email,
      actorRole: adminUser.role,
      action: 'admin_invite_accepted',
      category: 'admin_lifecycle',
      outcome: 'success',
      resourceType: 'admin_user',
      resourceId: adminUser.id,
      ipAddress: ctx?.ip,
      userAgent: ctx?.userAgent,
      retentionClass: 'security',
    });

    return {
      accessToken: this.signAdminToken(adminUser, session.id),
      user: {
        id: adminUser.id,
        name: adminUser.name,
        email: adminUser.email,
        role: adminUser.role,
      },
    };
  }

  async logout(user: AdminRequestUser): Promise<{ message: string }> {
    await this.adminUsersService.revokeSession(user.sessionId, 'logout');
    await this.audit.record({
      actorType: 'admin',
      actorId: user.id,
      actorEmail: user.email,
      actorRole: user.role,
      action: 'admin_logout',
      category: 'auth',
      outcome: 'success',
      resourceType: 'admin_session',
      resourceId: user.sessionId,
      retentionClass: 'security',
    });
    return { message: 'Logged out' };
  }

  async firebaseLogin(firebaseToken: string) {
    if (!firebaseToken?.trim()) {
      throw new BadRequestException('firebaseToken is required');
    }

    let decoded: DecodedIdToken;
    try {
      decoded = await admin.auth().verifyIdToken(firebaseToken);
    } catch {
      throw new UnauthorizedException('Invalid or expired Firebase token');
    }

    if (!decoded.phone_number) {
      throw new UnauthorizedException(
        'Phone number not verified. Sign in with Firebase Phone Authentication.',
      );
    }

    const phone = normalizePhone(decoded.phone_number);

    let existingUser =
      (await this.usersService.findByPhone(phone)) ??
      (await this.usersService.findByFirebaseUid(decoded.uid));

    let user = existingUser;

    if (!user) {
      user = await this.usersService.create({
        firebase_uid: decoded.uid,
        phone,
        name: '',
      });
    } else if (user.firebase_uid !== decoded.uid || user.phone !== phone) {
      user = await this.usersService.syncFirebaseIdentity(user.id, {
        firebase_uid: decoded.uid,
        phone,
      });
    }

    const accessToken = this.signAppToken(user.id);

    return {
      success: true,
      accessToken,
      user: toPublicProfile(user),
    };
  }
}
