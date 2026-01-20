import { describe, test, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { buildHL7Message, type PatientData } from "./hl7-builder";

const TEST_PDF_PATH = join(
  import.meta.dir,
  "../docs/Patient_Information_and_Consent_Form_2025-12-10T14-09-58_29503708_0 (1).pdf"
);

const samplePatient: PatientData = {
  firstName: "John",
  lastName: "Smith",
  dob: "19800115",
  sex: "M",
};

describe("HL7 PDF Embedding", () => {
  test("PDF is embedded as Base64 in OBX segment", () => {
    const pdfBuffer = readFileSync(TEST_PDF_PATH);
    const hl7 = buildHL7Message(samplePatient, pdfBuffer);

    // Check OBX segment exists with ED datatype
    expect(hl7).toContain("OBX|1|ED|");
    // Check PDF MIME type in ED format
    expect(hl7).toContain("^application^pdf^Base64^");
  });

  test("embedded Base64 decodes back to original PDF", () => {
    const pdfBuffer = readFileSync(TEST_PDF_PATH);
    const hl7 = buildHL7Message(samplePatient, pdfBuffer);

    // Extract Base64 from OBX-5 (after ^application^pdf^Base64^)
    const match = hl7.match(/\^application\^pdf\^Base64\^([A-Za-z0-9+/=]+)/);
    expect(match).not.toBeNull();

    const extractedBase64 = match![1];
    const decodedBuffer = Buffer.from(extractedBase64, "base64");

    // Verify decoded PDF matches original
    expect(decodedBuffer.equals(pdfBuffer)).toBe(true);
  });

  test("OBX segment has correct AUSPDI observation ID", () => {
    const pdfBuffer = readFileSync(TEST_PDF_PATH);
    const hl7 = buildHL7Message(samplePatient, pdfBuffer);

    expect(hl7).toContain("PDF^Display format in PDF^AUSPDI");
  });
});
