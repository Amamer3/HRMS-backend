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

  const leaveTypes = [
    {
      code: "ANNUAL_LEAVE",
      name: "Annual Leave",
      maxDaysPerYear: 21,
      allowCarryForward: true,
      requiresMedical: false,
      approvalChain: ["SUPERVISOR", "HR"],
    },
    {
      code: "MEDICAL_SICK_LEAVE",
      name: "Medical / Sick Leave",
      maxDaysPerYear: 30,
      allowCarryForward: false,
      requiresMedical: true,
      approvalChain: ["SUPERVISOR", "HR"],
    },
    {
      code: "EMERGENCY_LEAVE",
      name: "Emergency Leave",
      maxDaysPerYear: 10,
      allowCarryForward: false,
      requiresMedical: false,
      approvalChain: ["SUPERVISOR", "HR"],
    },
    {
      code: "PERSONAL_LEAVE",
      name: "Personal Leave",
      maxDaysPerYear: 7,
      allowCarryForward: false,
      requiresMedical: false,
      approvalChain: ["SUPERVISOR", "HR"],
    },
    {
      code: "WORK_FROM_HOME",
      name: "Work From Home",
      maxDaysPerYear: 60,
      allowCarryForward: false,
      requiresMedical: false,
      approvalChain: ["SUPERVISOR"],
    },
    {
      code: "UNPAID_LEAVE",
      name: "Unpaid Leave",
      maxDaysPerYear: null,
      allowCarryForward: false,
      requiresMedical: false,
      approvalChain: ["SUPERVISOR", "HR"],
    },
  ] as const;

  for (const lt of leaveTypes) {
    await prisma.leaveType.upsert({
      where: { code: lt.code },
      update: {
        name: lt.name,
        maxDaysPerYear: lt.maxDaysPerYear,
        allowCarryForward: lt.allowCarryForward,
        requiresMedical: lt.requiresMedical,
        approvalChain: lt.approvalChain,
      },
      create: {
        code: lt.code,
        name: lt.name,
        maxDaysPerYear: lt.maxDaysPerYear,
        allowCarryForward: lt.allowCarryForward,
        requiresMedical: lt.requiresMedical,
        approvalChain: lt.approvalChain,
      },
    });
  }

  console.log("Branches and leave types seeded successfully");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
