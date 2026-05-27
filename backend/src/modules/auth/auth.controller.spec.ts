import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

const mockAuthService = {
  register: jest.fn(),
  generateTokens: jest.fn().mockResolvedValue({
    accessToken: 'access',
    refreshToken: 'refresh',
  }),
};

describe('AuthController', () => {
  let controller: AuthController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ ttl: 60000, limit: 10 }])],
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: mockAuthService }],
    }).compile();
    controller = module.get(AuthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('login', () => {
    it('should return access and refresh tokens', async () => {
      const user = { id: '1', email: 'a@b.com', role: 'END_USER' } as any;
      const result = await controller.login(user);
      expect(result).toEqual({ accessToken: 'access', refreshToken: 'refresh' });
    });
  });

  describe('register', () => {
    it('should call authService.register with dto', async () => {
      const dto = { name: 'Alice', email: 'a@b.com', password: 'pass1234' };
      mockAuthService.register.mockResolvedValue({ id: '1', ...dto });
      const result = await controller.register(dto);
      expect(mockAuthService.register).toHaveBeenCalledWith(dto);
      expect(result).toHaveProperty('id');
    });
  });
});
