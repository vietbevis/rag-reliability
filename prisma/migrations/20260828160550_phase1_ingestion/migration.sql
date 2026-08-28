-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "contentTokens" INTEGER,
ADD COLUMN     "duplicateOfId" TEXT,
ADD COLUMN     "normalizedHash" TEXT,
ADD COLUMN     "rawContent" BYTEA,
ADD COLUMN     "transformations" JSONB NOT NULL DEFAULT '[]';

-- CreateIndex
CREATE INDEX "Document_normalizedHash_idx" ON "Document"("normalizedHash");

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_duplicateOfId_fkey" FOREIGN KEY ("duplicateOfId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;
