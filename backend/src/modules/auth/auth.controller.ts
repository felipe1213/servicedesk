import { Controller, Post, Body, UseGuards, Request, Get } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LocalAuthGuard } from './guards/local-auth.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RegisterDto } from './dto/register.dto';
import { User } from '@prisma/client';

@Controller('auth')
@UseGuards(ThrottlerGuard)
export class AuthController {
  constructor(private auth: AuthService) {}

  @UseGuards(LocalAuthGuard)
  @Post('login')
  async login(@Request() req: { user: Omit<User, 'password'> }) {
    return this.auth.generateTokens(req.user as User);
  }

  @Post('register')
  async register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@Request() req: { user: Partial<User> }) {
    return req.user;
  }
}
