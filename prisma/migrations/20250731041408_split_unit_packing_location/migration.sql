-- DropForeignKey
ALTER TABLE "Product" DROP CONSTRAINT "Product_packingUnitId_fkey";

-- CreateTable
CREATE TABLE "PackingUnit" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "PackingUnit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PackingUnit_name_key" ON "PackingUnit"("name");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_packingUnitId_fkey" FOREIGN KEY ("packingUnitId") REFERENCES "PackingUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
