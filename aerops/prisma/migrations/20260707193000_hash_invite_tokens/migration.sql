-- Phase 1B: store only one-way hashes of invitation and invite-link tokens.
-- Safe migration: add tokenHash, backfill sha256(token) IN PLACE so every
-- existing link keeps working, then drop the raw column. sha256 hex here is
-- byte-identical to lib/tokens.ts hashToken() (crypto sha256, hex digest),
-- so a token that worked before the migration still resolves after it.

-- Invitation ---------------------------------------------------------------
ALTER TABLE "Invitation" ADD COLUMN "tokenHash" TEXT;
UPDATE "Invitation" SET "tokenHash" = encode(sha256(convert_to("token", 'UTF8')), 'hex');
ALTER TABLE "Invitation" ALTER COLUMN "tokenHash" SET NOT NULL;
ALTER TABLE "Invitation" DROP COLUMN "token";
CREATE UNIQUE INDEX "Invitation_tokenHash_key" ON "Invitation"("tokenHash");

-- InviteLink ---------------------------------------------------------------
ALTER TABLE "InviteLink" ADD COLUMN "tokenHash" TEXT;
UPDATE "InviteLink" SET "tokenHash" = encode(sha256(convert_to("token", 'UTF8')), 'hex');
ALTER TABLE "InviteLink" ALTER COLUMN "tokenHash" SET NOT NULL;
ALTER TABLE "InviteLink" DROP COLUMN "token";
CREATE UNIQUE INDEX "InviteLink_tokenHash_key" ON "InviteLink"("tokenHash");
