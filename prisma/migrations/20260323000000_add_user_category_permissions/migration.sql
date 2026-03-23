-- CreateTable
CREATE TABLE "user_category_permissions" (
    "userId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "canView" BOOLEAN NOT NULL DEFAULT true,
    "canEdit" BOOLEAN NOT NULL DEFAULT true
);

-- CreateIndex
CREATE UNIQUE INDEX "user_category_permissions_userId_category_key" ON "user_category_permissions"("userId", "category");

-- CreateIndex
CREATE INDEX "user_category_permissions_userId_idx" ON "user_category_permissions"("userId");

-- AddForeignKey
ALTER TABLE "user_category_permissions" ADD CONSTRAINT "user_category_permissions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
