import { PDFDocument } from 'pdf-lib';

/**
 * Splits a PDF into multiple documents based on the provided page ranges.
 * @param pdfBytes The original PDF as a Uint8Array
 * @param ranges Array of objects with start and end page (1-based index)
 * @returns Array of Uint8Arrays, each representing a new PDF
 */
export async function splitPdf(pdfBytes: Uint8Array, ranges: { start: number, end: number }[]): Promise<Uint8Array[]> {
    const srcDoc = await PDFDocument.load(pdfBytes);
    const resultPdfs: Uint8Array[] = [];

    for (const range of ranges) {
        const newDoc = await PDFDocument.create();

        // Convert 1-based index to 0-based for pdf-lib
        const pageIndices = [];
        for (let i = range.start - 1; i <= range.end - 1; i++) {
            if (i >= 0 && i < srcDoc.getPageCount()) {
                pageIndices.push(i);
            }
        }

        if (pageIndices.length > 0) {
            const copiedPages = await newDoc.copyPages(srcDoc, pageIndices);
            copiedPages.forEach((page) => newDoc.addPage(page));
            const pdfBytesOutput = await newDoc.save();
            resultPdfs.push(pdfBytesOutput);
        }
    }

    return resultPdfs;
}

/**
 * Gets the total page count of a PDF.
 */
export async function getPdfPageCount(pdfBytes: Uint8Array): Promise<number> {
    const doc = await PDFDocument.load(pdfBytes);
    return doc.getPageCount();
}
