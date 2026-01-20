/**
 * PDF Text Extractor and Patient Data Parser
 * Designed for BJC Health Patient Information and Consent Form format
 */

import pdf from "pdf-parse";
import type { PatientData } from "./hl7-builder";

interface ExtractionResult {
  success: boolean;
  data: PatientData;
  warnings: string[];
}

// Extraction patterns based on BJC Health form structure
const PATTERNS = {
  // Note: PDF radio button selection state cannot be extracted from text
  // This pattern looks for a standalone title that might appear selected
  title: /^\s*(Mr|Mrs|Miss|Ms)\s*$/m,

  // Name fields
  firstName: /First Name\s*\*?\s*\n?\s*([A-Za-z]+)/i,
  lastName: /Last Name\s*\*?\s*\n?\s*([A-Za-z]+)/i,

  // Date of Birth - Australian format DD/MM/YYYY
  dob: /Date of Birth\s*\*?\s*\n?\s*(\d{1,2}\/\d{1,2}\/\d{4})/i,

  // Contact
  mobile: /Mobile Phone\s*\*?\s*\n?\s*([\d\s]{10,12})/i,

  // Address
  address: /Address\s*\*?\s*\n?\s*(.+?)(?=\n*Postcode|\n*City)/is,
  postcode: /Postcode\s*\*?\s*\n?\s*(\d{4})/i,
  suburb: /City\s*\/?\s*Suburb\s*\*?\s*\n?\s*([A-Za-z\s]+?)(?=\n|State)/i,

  // Medicare
  medicareNo: /Medicare Card No\.?\s*\*?\s*\n?\s*(\d{10,11})/i,
  medicareRef: /Medicare Ref\s*(?:Number)?\s*\*?\s*\n?\s*(\d)/i,
};

// Map title to sex
const TITLE_TO_SEX: Record<string, "M" | "F" | "U"> = {
  Mr: "M",
  Mrs: "F",
  Miss: "F",
  Ms: "F",
  Mx: "U",
  Dr: "U",
};

// Australian postcode to state mapping (approximate)
const POSTCODE_TO_STATE: Record<string, string> = {
  "2": "NSW",
  "3": "VIC",
  "4": "QLD",
  "5": "SA",
  "6": "WA",
  "7": "TAS",
  "0": "NT",
};

/**
 * Convert Australian date format (DD/MM/YYYY) to HL7 format (YYYYMMDD)
 */
function convertDateToHL7(dateStr: string): string {
  const match = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!match) return "19000101"; // Fallback

  const [, day, month, year] = match;
  return `${year}${month.padStart(2, "0")}${day.padStart(2, "0")}`;
}

/**
 * Infer state from Australian postcode
 */
function inferStateFromPostcode(postcode: string): string {
  if (!postcode || postcode.length !== 4) return "VIC"; // Default to VIC
  const firstDigit = postcode[0];
  return POSTCODE_TO_STATE[firstDigit] || "VIC";
}

/**
 * Clean and normalize extracted text
 */
function cleanText(text: string | undefined): string {
  if (!text) return "";
  return text.trim().replace(/\s+/g, " ");
}

/**
 * Extract a single field using regex pattern
 */
function extractField(text: string, pattern: RegExp): string | null {
  const match = text.match(pattern);
  return match ? cleanText(match[1]) : null;
}

/**
 * Extract patient data from PDF text
 */
export async function extractPatientData(
  pdfBuffer: Buffer
): Promise<ExtractionResult> {
  const warnings: string[] = [];

  // Default/fallback values
  const defaultData: PatientData = {
    firstName: "UNKNOWN",
    lastName: "PATIENT",
    dob: "19000101",
    sex: "U",
  };

  try {
    // Parse PDF to extract text
    const pdfData = await pdf(pdfBuffer);
    const text = pdfData.text;

    if (!text || text.trim().length === 0) {
      warnings.push("PDF contains no extractable text");
      return { success: false, data: defaultData, warnings };
    }

    // Extract fields
    const firstName = extractField(text, PATTERNS.firstName);
    const lastName = extractField(text, PATTERNS.lastName);
    const dobRaw = extractField(text, PATTERNS.dob);
    const mobile = extractField(text, PATTERNS.mobile);
    const address = extractField(text, PATTERNS.address);
    const postcode = extractField(text, PATTERNS.postcode);
    const suburb = extractField(text, PATTERNS.suburb);
    const medicareNo = extractField(text, PATTERNS.medicareNo);
    const medicareRef = extractField(text, PATTERNS.medicareRef);

    // Determine sex from title
    let sex: "M" | "F" | "U" = "U";
    const titleMatch = text.match(PATTERNS.title);
    if (titleMatch) {
      sex = TITLE_TO_SEX[titleMatch[1]] || "U";
    }

    // Build patient data
    const patientData: PatientData = {
      firstName: firstName || defaultData.firstName,
      lastName: lastName || defaultData.lastName,
      dob: dobRaw ? convertDateToHL7(dobRaw) : defaultData.dob,
      sex,
      phone: mobile?.replace(/\s/g, "") || undefined,
      address: address || undefined,
      suburb: suburb || undefined,
      postcode: postcode || undefined,
      state: postcode ? inferStateFromPostcode(postcode) : undefined,
      medicareNo: medicareNo?.replace(/\s/g, "") || undefined,
      medicareRef: medicareRef || undefined,
    };

    // Add warnings for missing fields
    if (!firstName) warnings.push("Could not extract first name");
    if (!lastName) warnings.push("Could not extract last name");
    if (!dobRaw) warnings.push("Could not extract date of birth");
    if (sex === "U") warnings.push("Could not determine sex from title");
    if (!medicareNo) warnings.push("Could not extract Medicare number");

    const success =
      patientData.firstName !== "UNKNOWN" &&
      patientData.lastName !== "PATIENT";

    return { success, data: patientData, warnings };
  } catch (error) {
    warnings.push(`PDF parsing error: ${error instanceof Error ? error.message : "Unknown error"}`);
    return { success: false, data: defaultData, warnings };
  }
}

/**
 * Format extracted data for display
 */
export function formatExtractedData(data: PatientData): {
  firstName: string;
  lastName: string;
  dob: string;
  sex: string;
  medicareNo: string;
} {
  // Convert DOB back to readable format
  const dob = data.dob;
  const formattedDob =
    dob.length === 8
      ? `${dob.substring(6, 8)}/${dob.substring(4, 6)}/${dob.substring(0, 4)}`
      : dob;

  return {
    firstName: data.firstName,
    lastName: data.lastName,
    dob: formattedDob,
    sex: data.sex === "M" ? "Male" : data.sex === "F" ? "Female" : "Unknown",
    medicareNo: data.medicareNo
      ? `${data.medicareNo}${data.medicareRef ? `-${data.medicareRef}` : ""}`
      : "Not provided",
  };
}
