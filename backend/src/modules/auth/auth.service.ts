import { Injectable, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthProvider, Role, User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { RegisterDto } from './dto/register.dto';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
  ) {}

  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 10);
  }

  async comparePassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  async validateLocalUser(email: string, password: string): Promise<User | null> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.password) return null;
    const valid = await this.comparePassword(password, user.password);
    return valid ? user : null;
  }

  async register(dto: RegisterDto): Promise<Omit<User, 'password'>> {
    const hashed = await this.hashPassword(dto.password);
    try {
      const user = await this.prisma.user.create({
        data: {
          name: dto.name,
          email: dto.email,
          password: hashed,
          authProvider: AuthProvider.LOCAL,
          role: Role.END_USER,
        },
        select: {
          id: true, name: true, email: true, role: true,
          authProvider: true, teamId: true, createdAt: true, updatedAt: true,
          password: false,
        },
      });
      return user as Omit<User, 'password'>;
    } catch (e: any) {
      if (e?.code === 'P2002') throw new ConflictException('Email already registered');
      throw e;
    }
  }

  async generateTokens(user: User): Promise<{ accessToken: string; refreshToken: string }> {
    const payload = { sub: user.id, email: user.email, role: user.role };
    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(payload, {
        secret: this.config.get<string>('JWT_SECRET'),
        expiresIn: this.config.get<string>('JWT_ACCESS_EXPIRES_IN'),
      }),
      this.jwt.signAsync(payload, {
        secret: this.config.get<string>('JWT_REFRESH_SECRET'),
        expiresIn: this.config.get<string>('JWT_REFRESH_EXPIRES_IN'),
      }),
    ]);
    return { accessToken, refreshToken };
  }

  async findOrCreateEntraUser(profile: { oid: string; email: string; name: string }): Promise<User> {
    return this.prisma.user.upsert({
      where: { email: profile.email },
      update: {},
      create: {
        name: profile.name,
        email: profile.email,
        authProvider: AuthProvider.ENTRA_ID,
        role: Role.END_USER,
      },
    });
  }
}
