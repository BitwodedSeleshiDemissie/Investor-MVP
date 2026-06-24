import crypto from "crypto";
import { getPrisma } from "@/db/prisma";
import { parseDirectaLiquidityPdf, type DirectaLiquidityPdf } from "@/lib/directa-pdf";

function pdfHash(content: Buffer): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function prismaBytes(content: Buffer): Uint8Array<ArrayBuffer> {
  return new Uint8Array(content);
}

function parseDateOnly(value: string | null): Date | null {
  return value ? new Date(`${value}T00:00:00Z`) : null;
}

export type DirectaPdfSyncResult = DirectaLiquidityPdf & {
  id: number;
  fileHash: string;
};

export async function syncDirectaPdfFile({
  fileName,
  content,
  uploadedBy,
}: {
  fileName: string;
  content: Buffer;
  uploadedBy: string;
}): Promise<DirectaPdfSyncResult> {
  const prisma = getPrisma();
  const parsed = await parseDirectaLiquidityPdf(content, fileName);
  const fileHash = pdfHash(content);
  const statementDate = parseDateOnly(parsed.statementDate);
  const storedContent = prismaBytes(content);

  const inserted = await prisma.directa_pdf_files.upsert({
    where: { file_hash: fileHash },
    create: {
      filename: fileName,
      file_hash: fileHash,
      statement_date: statementDate,
      liquidity: parsed.liquidity,
      listed_total: parsed.listedTotal,
      uploaded_by: uploadedBy,
      content: storedContent,
    },
    update: {
      filename: fileName,
      statement_date: statementDate,
      liquidity: parsed.liquidity,
      listed_total: parsed.listedTotal,
      uploaded_by: uploadedBy,
      uploaded_at: new Date(),
      content: storedContent,
    },
    select: { id: true },
  });

  return {
    ...parsed,
    id: Number(inserted.id),
    fileHash,
  };
}
