import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const branches = [
    {
      code: "ECHT_OFFICE",
      name: "ECHT OFFICE",
      latitude: 5.5673,
      longitude: -0.1705,
      geofenceRadiusM: 80,
      workdayStartLocal: "08:30",
      workdayEndLocal: "17:00",
      lateGraceMinutes: 30, // 8:30 + 30 = 9:00 AM
    },
    {
      code: "EPA_OFFICE",
      name: "EPA OFFICE",
      latitude: 5.55174,
      longitude: -0.20015,
      geofenceRadiusM: 80,
      workdayStartLocal: "08:30",
      workdayEndLocal: "17:00",
      lateGraceMinutes: 30,
    },
  ];

  for (const b of branches) {
    await prisma.branch.upsert({
      where: { code: b.code },
      update: b,
      create: b,
    });
  }

  console.log("Branches seeded successfully");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
