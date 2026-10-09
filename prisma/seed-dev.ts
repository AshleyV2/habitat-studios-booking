/**
 * DEVELOPMENT ONLY — never run on Habitat's production installation (it refuses to).
 *
 * Creates clearly-labelled sample configuration so a developer can exercise the
 * booking flow locally. It creates NO bookings and NO customers. Habitat's real
 * rooms, prices, equipment and hours are entered by their administrator (docs/INSTALL.md).
 *
 *   Dev admin: dev-admin@habitat.local / Habitat-dev-admin-1
 */
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../server/src/auth/password';

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to run the development seed with NODE_ENV=production.');
  process.exit(1);
}

const prisma = new PrismaClient();

async function main() {
  await prisma.staffUser.upsert({
    where: { email: 'dev-admin@habitat.local' },
    update: {},
    create: { email: 'dev-admin@habitat.local', name: 'Dev Admin', role: 'ADMIN', passwordHash: await hashPassword('Habitat-dev-admin-1') },
  });
  await prisma.settings.upsert({ where: { id: 1 }, create: { id: 1, businessName: 'Habitat Studios (DEV)', timezone: 'Europe/London', minNoticeMinutes: 0 }, update: {} });
  for (let d = 0; d < 7; d++) {
    await prisma.openingHours.upsert({ where: { dayOfWeek: d }, create: { dayOfWeek: d, isOpen: true, openMinute: 10 * 60, closeMinute: 24 * 60 }, update: {} });
  }
  if ((await prisma.room.count()) === 0) {
    const a = await prisma.room.create({ data: { name: 'DEV Room A', description: 'Development sample room.', capacity: 6, hourlyRatePence: 1500, colour: '#3d6b8f', sortOrder: 1 } });
    await prisma.room.create({ data: { name: 'DEV Room B', description: 'Development sample room.', capacity: 4, hourlyRatePence: 1200, colour: '#7a5c2e', sortOrder: 2 } });
    await prisma.priceRule.create({ data: { roomId: a.id, label: 'Evening', daysOfWeek: [1, 2, 3, 4, 5], startMinute: 18 * 60, endMinute: 24 * 60, hourlyRatePence: 1800 } });
  }
  if ((await prisma.equipment.count()) === 0) {
    await prisma.equipment.createMany({
      data: [
        { name: 'DEV Microphone', pricePence: 300, pricing: 'PER_BOOKING', quantity: 4, sortOrder: 1 },
        { name: 'DEV Guitar amp', pricePence: 250, pricing: 'PER_HOUR', quantity: 2, sortOrder: 2 },
      ],
    });
  }
  console.log('Development configuration seeded (no bookings or customers created).');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
