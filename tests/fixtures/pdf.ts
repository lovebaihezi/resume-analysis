export function pdfWithPages(pageCount: number, label = "Resume"): Buffer {
    const pageObjects = Array.from({ length: pageCount }, (_, index) => {
        const objectId = index + 3;

        return `${objectId} 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${objectId + pageCount} 0 R >>
endobj`;
    }).join("\n");
    const contentObjects = Array.from({ length: pageCount }, (_, index) => {
        const objectId = index + 3 + pageCount;
        const stream = `BT /F1 12 Tf 72 720 Td (${label} ${index + 1}) Tj ET`;

        return `${objectId} 0 obj
<< /Length ${Buffer.byteLength(stream)} >>
stream
${stream}
endstream
endobj`;
    }).join("\n");
    const kids = Array.from(
        { length: pageCount },
        (_, index) => `${index + 3} 0 R`,
    ).join(" ");

    return Buffer.from(`%PDF-1.7
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Count ${pageCount} /Kids [${kids}] >>
endobj
${pageObjects}
${contentObjects}
trailer
<< /Root 1 0 R >>
%%EOF`);
}
