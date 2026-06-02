import crypto from "crypto";
import { getPrisma } from "@/db/prisma";
import { parseDirectaLiquidityPdf, type DirectaLiquidityPdf, type DirectaPdfPosition } from "@/lib/directa-pdf";

function pdfHash(content: Buffer): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function positionHash(fileHash: string, rowNumber: number, position: DirectaPdfPosition): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify({
      fileHash,
      rowNumber,
      isin: position.isin,
      security: position.security,
      quantity: position.quantity,
      price: position.price,
      marketValue: position.marketValue,
    }))
    .digest("hex");
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

  const inserted = await prisma.$transaction(
    async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: bigint }>>`
        INSERT INTO directa_pdf_files (
          filename, file_hash, statement_date, liquidity, listed_total, uploaded_by, content
        )
        VALUES (
          ${fileName}, ${fileHash}, ${statementDate}, ${parsed.liquidity}, ${parsed.listedTotal}, ${uploadedBy}, ${content}
        )
        ON CONFLICT (file_hash) DO UPDATE SET
          filename = EXCLUDED.filename,
          statement_date = EXCLUDED.statement_date,
          liquidity = EXCLUDED.liquidity,
          listed_total = EXCLUDED.listed_total,
          uploaded_by = EXCLUDED.uploaded_by,
          uploaded_at = CURRENT_TIMESTAMP,
          content = EXCLUDED.content
        RETURNING id
      `;
      const pdfFileId = rows[0].id;

      await tx.$executeRaw`
        DELETE FROM directa_pdf_positions
        WHERE pdf_file_id = ${pdfFileId}
      `;

      for (const [index, position] of parsed.positions.entries()) {
        const rowNumber = index + 1;
        await tx.$executeRaw`
          INSERT INTO directa_pdf_positions (
            pdf_file_id, row_number, row_hash, statement_date, security_name, isin, quantity, price, market_value
          )
          VALUES (
            ${pdfFileId},
            ${rowNumber},
            ${positionHash(fileHash, rowNumber, position)},
            ${statementDate},
            ${position.security},
            ${position.isin},
            ${position.quantity},
            ${position.price},
            ${position.marketValue}
          )
          ON CONFLICT (row_hash) DO NOTHING
        `;

        await tx.$executeRaw`
          INSERT INTO security_master (
            isin, display_name, source, latest_price, latest_market_value, latest_statement_date, updated_at
          )
          VALUES (
            ${position.isin},
            ${position.security},
            'Directa PDF',
            ${position.price},
            ${position.marketValue},
            ${statementDate},
            CURRENT_TIMESTAMP
          )
          ON CONFLICT (isin) DO UPDATE SET
            display_name = EXCLUDED.display_name,
            source = EXCLUDED.source,
            latest_price = EXCLUDED.latest_price,
            latest_market_value = EXCLUDED.latest_market_value,
            latest_statement_date = EXCLUDED.latest_statement_date,
            updated_at = CURRENT_TIMESTAMP
        `;
      }

      return pdfFileId;
    },
    { maxWait: 10_000, timeout: 30_000 }
  );

  return {
    ...parsed,
    id: Number(inserted),
    fileHash,
  };
}
