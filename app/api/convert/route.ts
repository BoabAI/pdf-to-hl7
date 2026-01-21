import { NextRequest, NextResponse } from "next/server";
import { buildHL7Message, generateHL7Filename } from "@/lib/hl7-builder";
import { extractPatientData, formatExtractedData } from "@/lib/pdf-parser";

// Maximum file size: 10MB
const MAX_FILE_SIZE = 10 * 1024 * 1024;

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("pdf") as File | null;

    // Validate file exists
    if (!file) {
      return NextResponse.json(
        { success: false, error: "No PDF file provided" },
        { status: 400 }
      );
    }

    // Validate file type
    if (file.type !== "application/pdf") {
      return NextResponse.json(
        { success: false, error: "File must be a PDF" },
        { status: 400 }
      );
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { success: false, error: "File size exceeds 10MB limit" },
        { status: 400 }
      );
    }

    // Convert file to buffer
    const arrayBuffer = await file.arrayBuffer();
    const pdfBuffer = Buffer.from(arrayBuffer);

    // Get document type preference (auto, consent_form, or referral_letter)
    const documentTypeParam = formData.get("documentType") as string | null;
    const documentType =
      documentTypeParam === "consent_form" || documentTypeParam === "referral_letter"
        ? documentTypeParam
        : "auto";

    // Extract patient data from PDF
    const extraction = await extractPatientData(pdfBuffer, documentType);

    if (!extraction.success && extraction.warnings.length > 0) {
      console.warn("PDF extraction warnings:", extraction.warnings);
    }

    // Extract Genie action options
    const autoFile = formData.get("autoFile") !== "false"; // Default to true
    const orderingProvider = formData.get("orderingProvider") as string | null;

    // Build HL7 message with embedded PDF
    const hl7Content = buildHL7Message(extraction.data, pdfBuffer, {
      documentTitle: file.name.replace(/\.pdf$/i, ""),
      resultStatus: autoFile ? "F" : "P", // F=Final (auto-file), P=Preliminary (queue)
      orderingProvider: orderingProvider || undefined,
    });

    // Generate filename
    const filename = generateHL7Filename(extraction.data);

    // Format extracted data for display
    const extractedData = formatExtractedData(extraction.data);

    return NextResponse.json({
      success: true,
      filename,
      hl7Content,
      extractedData,
      warnings: extraction.warnings,
    });
  } catch (error) {
    console.error("Conversion error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Conversion failed",
      },
      { status: 500 }
    );
  }
}

// Health check endpoint
export async function GET() {
  return NextResponse.json({
    status: "ok",
    service: "PDF to HL7 Converter",
    version: "1.0.0",
  });
}
