import { describe, test, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { extractPatientData, type DocumentType } from "./pdf-parser";

// Test PDFs
const CONSENT_FORM_PATH = join(
  import.meta.dir,
  "../docs/Patient_Information_and_Consent_Form_2025-12-10T14-09-58_29503708_0 (1).pdf"
);

const REFERRAL_DUMMY_PATH = join(
  import.meta.dir,
  "../docs/input PDF/Referral_dummy.pdf"
);

describe("Document Type Detection", () => {
  test("detects consent form correctly", async () => {
    const pdfBuffer = readFileSync(CONSENT_FORM_PATH);
    const result = await extractPatientData(pdfBuffer);

    expect(result.documentType).toBe("consent_form");
  });

  test("detects referral letter correctly", async () => {
    const pdfBuffer = readFileSync(REFERRAL_DUMMY_PATH);
    const result = await extractPatientData(pdfBuffer);

    expect(result.documentType).toBe("referral_letter");
  });
});

describe("Referral Letter Extraction", () => {
  test("extracts patient name from RE: line", async () => {
    const pdfBuffer = readFileSync(REFERRAL_DUMMY_PATH);
    const result = await extractPatientData(pdfBuffer);

    expect(result.success).toBe(true);
    expect(result.data.firstName).toBe("John");
    expect(result.data.lastName).toBe("SMITH");
  });

  test("extracts DOB from RE: line", async () => {
    const pdfBuffer = readFileSync(REFERRAL_DUMMY_PATH);
    const result = await extractPatientData(pdfBuffer);

    // DOB 15/06/1980 should convert to YYYYMMDD format
    expect(result.data.dob).toBe("19800615");
  });

  test("extracts phone number", async () => {
    const pdfBuffer = readFileSync(REFERRAL_DUMMY_PATH);
    const result = await extractPatientData(pdfBuffer);

    // Phone should be extracted and cleaned (spaces removed)
    expect(result.data.phone).toBe("0400000000");
  });

  test("infers sex from pronouns", async () => {
    const pdfBuffer = readFileSync(REFERRAL_DUMMY_PATH);
    const result = await extractPatientData(pdfBuffer);

    // The dummy letter uses "he/his" pronouns
    expect(result.data.sex).toBe("M");
  });

  test("extracts address components", async () => {
    const pdfBuffer = readFileSync(REFERRAL_DUMMY_PATH);
    const result = await extractPatientData(pdfBuffer);

    // Address extraction is medium reliability
    // If extracted, should have postcode
    if (result.data.postcode) {
      expect(result.data.postcode).toBe("2000");
      expect(result.data.state).toBe("NSW");
    }
  });

  test("does not warn about missing Medicare (not expected in referrals)", async () => {
    const pdfBuffer = readFileSync(REFERRAL_DUMMY_PATH);
    const result = await extractPatientData(pdfBuffer);

    // Medicare should not be expected in referral letters
    const medicareWarning = result.warnings.find((w) =>
      w.toLowerCase().includes("medicare")
    );
    expect(medicareWarning).toBeUndefined();
  });
});

describe("Consent Form Extraction (Regression)", () => {
  test("still extracts data from consent forms", async () => {
    const pdfBuffer = readFileSync(CONSENT_FORM_PATH);
    const result = await extractPatientData(pdfBuffer);

    // Document type should be consent_form
    expect(result.documentType).toBe("consent_form");

    // Should still be able to extract some data (may have warnings if form fields empty)
    expect(result.data).toHaveProperty("firstName");
    expect(result.data).toHaveProperty("lastName");
    expect(result.data).toHaveProperty("dob");
    expect(result.data).toHaveProperty("sex");
  });

  test("warns about missing Medicare in consent forms", async () => {
    const pdfBuffer = readFileSync(CONSENT_FORM_PATH);
    const result = await extractPatientData(pdfBuffer);

    // If extraction fails, should warn about Medicare (expected in consent forms)
    if (!result.data.medicareNo) {
      const medicareWarning = result.warnings.find((w) =>
        w.toLowerCase().includes("medicare")
      );
      expect(medicareWarning).toBeDefined();
    }
  });
});
