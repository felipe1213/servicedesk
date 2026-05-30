-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN "ticketNumber" SERIAL;

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_ticketNumber_key" ON "Ticket"("ticketNumber");
