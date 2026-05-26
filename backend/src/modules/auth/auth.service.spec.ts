import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { PrismaService } from '../../prisma/prisma.service';

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    create: jest.fn(),
  },
};
const mockJwt = { signAsync: jest.fn(), verifyAsync: jest.fn() };
const mockConfig = { get: jest.fn((key: string) => {
  const map: Record<string, string> = {
    JWT_SECRET: 'test_secret',
    JWT_ACCESS_EXPIRES_IN: '15m',
    JWT_REFRESH_EXPIRES_IN: '7d',
  };
  return map[key];
})};

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: JwtService, useValue: mockJwt },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();
    service = module.get(AuthService);
  });

  describe('hashPassword', () => {
    it('should return a bcrypt hash different from the input', async () => {
      const hash = await service.hashPassword('secret123');
      expect(hash).not.toBe('secret123');
      expect(hash.startsWith('$2b$')).toBe(true);
    });
  });

  describe('comparePassword', () => {
    it('should return true for matching password and hash', async () => {
      const hash = await service.hashPassword('secret123');
      const result = await service.comparePassword('secret123', hash);
      expect(result).toBe(true);
    });

    it('should return false for wrong password', async () => {
      const hash = await service.hashPassword('secret123');
      const result = await service.comparePassword('wrong', hash);
      expect(result).toBe(false);
    });
  });
});
