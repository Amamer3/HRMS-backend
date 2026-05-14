-- CreateEnum (idempotent — skipped if AppRole already exists)
DO $$ BEGIN
  CREATE TYPE "AppRole" AS ENUM ('SUPER_ADMIN', 'HR_ADMIN', 'MANAGER', 'EMPLOYEE', 'READ_ONLY');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AlterTable: add role column to User if it doesn't already exist
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'User' AND column_name = 'role'
  ) THEN
    ALTER TABLE "User" ADD COLUMN "role" "AppRole" NOT NULL DEFAULT 'EMPLOYEE';
  END IF;
END $$;
