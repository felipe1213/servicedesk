import { PrismaClient, AuthProvider, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const users = [
    { name: 'Admin User', email: 'admin@inktel.com', password: 'Admin123!', role: Role.ADMIN },
    { name: 'Agent User', email: 'agent@inktel.com', password: 'Agent123!', role: Role.AGENT },
    { name: 'End User', email: 'user@inktel.com', password: 'User123!', role: Role.END_USER },
  ];

  for (const u of users) {
    const hashed = await bcrypt.hash(u.password, 10);
    await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: {
        name: u.name,
        email: u.email,
        password: hashed,
        role: u.role,
        authProvider: AuthProvider.LOCAL,
      },
    });
    console.log(`✓ ${u.role}: ${u.email} / ${u.password}`);
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
