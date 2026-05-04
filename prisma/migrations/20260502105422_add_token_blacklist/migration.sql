-- CreateTable
CREATE TABLE "TokenBlacklist" (
    "id" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TokenBlacklist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollSetting" (
    "id" UUID NOT NULL,
    "payrollCycleType" TEXT NOT NULL DEFAULT 'MONTHLY',
    "payslipFormatJson" JSONB NOT NULL DEFAULT '{}',
    "taxConfigJson" JSONB NOT NULL DEFAULT '{}',
    "benefitsConfigJson" JSONB NOT NULL DEFAULT '{}',
    "lateDeductionRules" JSONB NOT NULL DEFAULT '[]',
    "absenceDeductionRules" JSONB NOT NULL DEFAULT '[]',
    "overtimeMultiplier" DECIMAL(3,2) NOT NULL DEFAULT 1.5,
    "lastUpdatedById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TokenBlacklist_tokenHash_key" ON "TokenBlacklist"("tokenHash");

-- CreateIndex
CREATE INDEX "TokenBlacklist_tokenHash_idx" ON "TokenBlacklist"("tokenHash");

-- CreateIndex
CREATE INDEX "TokenBlacklist_userId_idx" ON "TokenBlacklist"("userId");

-- CreateIndex
CREATE INDEX "TokenBlacklist_expiresAt_idx" ON "TokenBlacklist"("expiresAt");

-- CreateIndex
CREATE INDEX "PayrollSetting_updatedAt_idx" ON "PayrollSetting"("updatedAt");

-- AddForeignKey
ALTER TABLE "TokenBlacklist" ADD CONSTRAINT "TokenBlacklist_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollSetting" ADD CONSTRAINT "PayrollSetting_lastUpdatedById_fkey" FOREIGN KEY ("lastUpdatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
