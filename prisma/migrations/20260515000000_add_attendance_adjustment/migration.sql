-- CreateTable
CREATE TABLE IF NOT EXISTS "AttendanceAdjustment" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "workDate" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "requestedChanges" JSONB NOT NULL,
    "workflowInstanceId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "AttendanceAdjustment_workflowInstanceId_key" ON "AttendanceAdjustment"("workflowInstanceId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AttendanceAdjustment_userId_workDate_idx" ON "AttendanceAdjustment"("userId", "workDate");

-- AddForeignKey
ALTER TABLE "AttendanceAdjustment" ADD CONSTRAINT "AttendanceAdjustment_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceAdjustment" ADD CONSTRAINT "AttendanceAdjustment_workflowInstanceId_fkey"
    FOREIGN KEY ("workflowInstanceId") REFERENCES "WorkflowInstance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
