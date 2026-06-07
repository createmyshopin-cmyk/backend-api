import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { LoginDto, RegisterDto } from './dto/auth.dto';
import { UsersService, toPublicProfile } from '../users/users.service';
import admin from './firebase-admin';

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
  ) {}

  private users = [
    {
      id: 'ADM001',
      name: 'Super Admin',
      email: 'admin@coincalling.com',
      password: 'password123',
      role: 'super_admin',
    },
    {
      id: 'ADM002',
      name: 'Rohan Fin',
      email: 'rohan.fin@coincalling.com',
      password: 'password123',
      role: 'finance_admin',
    },
    {
      id: 'ADM003',
      name: 'Sarah Mod',
      email: 'sarah.mod@coincalling.com',
      password: 'password123',
      role: 'moderator',
    },
  ];

  private signAppToken(userId: string): string {
    return this.jwtService.sign({ userId, sub: userId });
  }

  private signAdminToken(user: { id: string; role: string }): string {
    return this.jwtService.sign({
      userId: user.id,
      sub: user.id,
      role: user.role,
      type: 'admin',
    });
  }

  async login(loginDto: LoginDto) {
    const user = this.users.find(
      (u) => u.email === loginDto.email && u.password === loginDto.password,
    );
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }
    return {
      accessToken: this.signAdminToken(user),
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    };
  }

  async register(registerDto: RegisterDto) {
    const newUser = {
      id: `ADM${Date.now().toString().slice(-3)}`,
      name: registerDto.name,
      email: registerDto.email,
      password: registerDto.password,
      role: 'moderator',
    };
    this.users.push(newUser);
    return {
      message: 'Registration successful',
      user: {
        id: newUser.id,
        name: newUser.name,
        email: newUser.email,
        role: newUser.role,
      },
    };
  }

  async firebaseLogin(firebaseToken: string) {
    if (!firebaseToken?.trim()) {
      throw new BadRequestException('firebaseToken is required');
    }

    let decoded: admin.auth.DecodedIdToken;
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

    console.log('Firebase UID:', decoded.uid);
    console.log('Phone:', phone);
    console.log('User Found:', existingUser?.id ?? null);

    let user = existingUser;

    if (!user) {
      console.log('Creating new user');
      user = await this.usersService.create({
        firebase_uid: decoded.uid,
        phone,
        name: '',
      });
    } else if (
      user.firebase_uid !== decoded.uid ||
      user.phone !== phone
    ) {
      console.log('Running syncFirebaseIdentity');
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
