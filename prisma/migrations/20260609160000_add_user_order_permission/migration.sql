-- CreateEnum
CREATE TYPE "OrderBoardLevel" AS ENUM ('NONE', 'APPROVER', 'CREATOR', 'FULL');

-- CreateTable
CREATE TABLE "user_order_permissions" (
    "userId" TEXT NOT NULL,
    "level" "OrderBoardLevel" NOT NULL DEFAULT 'NONE'
);

-- CreateIndex
CREATE UNIQUE INDEX "user_order_permissions_userId_key" ON "user_order_permissions"("userId");

-- AddForeignKey
ALTER TABLE "user_order_permissions" ADD CONSTRAINT "user_order_permissions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
