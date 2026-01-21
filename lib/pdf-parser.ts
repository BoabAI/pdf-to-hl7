/**
 * PDF Text Extractor and Patient Data Parser
 * Supports:
 * - BJC Health Patient Information and Consent Form
 * - Specialist Referral Letters (e.g., from NeuroSpine Clinic)
 */

import pdf from "pdf-parse";
import type { PatientData } from "./hl7-builder";

// Document types supported
export type DocumentType = "consent_form" | "referral_letter";

export interface ExtractionResult {
  success: boolean;
  data: PatientData;
  warnings: string[];
  documentType: DocumentType;
}

// Extraction patterns for BJC Health consent forms
const CONSENT_FORM_PATTERNS = {
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

// Extraction patterns for referral letters (HIGH reliability)
const REFERRAL_PATTERNS = {
  // RE: FirstName LASTNAME - DOB: DD/MM/YYYY
  // Handles both "RE: Scott LAWLER" and "RE: LAWLER, Scott" formats
  patientLine:
    /RE:\s*(?:([A-Za-z]+)\s+([A-Z][A-Z]+)|([A-Z][A-Z]+),\s*([A-Za-z]+))\s*[-–]\s*DOB:\s*(\d{1,2}\/\d{1,2}\/\d{4})/i,

  // Provider No: 457833CF (legally required on Australian medical letters)
  providerNo: /Provider\s*No[:\.]?\s*(\d{6}[A-Z]{2})/i,

  // Letter date - "13 January 2026" format
  letterDate:
    /(\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})/i,

  // Recipient doctor - "Dear Dr Altie" or "Dear Professor Smith"
  recipientDoctor: /Dear\s+(?:Dr|Professor)\s+([A-Za-z\s]+?)(?:\n|,)/i,
};

// Secondary patterns for referral letters (MEDIUM reliability)
const REFERRAL_PATTERNS_SECONDARY = {
  // Phone - try multiple labels
  phone: /(?:Mobile|Ph|Tel|Phone)[:\s]+(\d[\d\s]{9,14})/i,

  // Address line after RE: line
  // Matches: "104 Stratford Road, TAHMOOR, NSW, 2573"
  addressLine:
    /^\s*(\d+[^,\n]+),\s*([A-Z][A-Za-z\s]+),\s*([A-Z]{2,3}),?\s*(\d{4})\s*$/m,
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
 * Detect document type from PDF text content
 */
function detectDocumentType(text: string): DocumentType {
  // Referral letters have "Dear Dr" and "RE:" patterns
  const hasDearDr = /Dear\s+(?:Dr|Professor)/i.test(text);
  const hasReLine = /RE:/i.test(text);

  if (hasDearDr && hasReLine) {
    return "referral_letter";
  }
  return "consent_form";
}

/**
 * Infer sex from pronouns in text
 */
function inferSexFromPronouns(text: string): "M" | "F" | "U" {
  const malePronouns = (text.match(/\b(he|him|his)\b/gi) || []).length;
  const femalePronouns = (text.match(/\b(she|her|hers)\b/gi) || []).length;

  if (malePronouns > femalePronouns && malePronouns >= 2) return "M";
  if (femalePronouns > malePronouns && femalePronouns >= 2) return "F";
  return "U";
}

/**
 * Extract patient data from consent form PDF
 */
function extractConsentFormData(
  text: string,
  warnings: string[]
): { data: PatientData; success: boolean } {
  const defaultData: PatientData = {
    firstName: "UNKNOWN",
    lastName: "PATIENT",
    dob: "19000101",
    sex: "U",
  };

  // Extract fields using consent form patterns
  const firstName = extractField(text, CONSENT_FORM_PATTERNS.firstName);
  const lastName = extractField(text, CONSENT_FORM_PATTERNS.lastName);
  const dobRaw = extractField(text, CONSENT_FORM_PATTERNS.dob);
  const mobile = extractField(text, CONSENT_FORM_PATTERNS.mobile);
  const address = extractField(text, CONSENT_FORM_PATTERNS.address);
  const postcode = extractField(text, CONSENT_FORM_PATTERNS.postcode);
  const suburb = extractField(text, CONSENT_FORM_PATTERNS.suburb);
  const medicareNo = extractField(text, CONSENT_FORM_PATTERNS.medicareNo);
  const medicareRef = extractField(text, CONSENT_FORM_PATTERNS.medicareRef);

  // Determine sex from title
  let sex: "M" | "F" | "U" = "U";
  const titleMatch = text.match(CONSENT_FORM_PATTERNS.title);
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
    patientData.firstName !== "UNKNOWN" && patientData.lastName !== "PATIENT";

  return { data: patientData, success };
}

/**
 * Extract patient data from referral letter PDF
 */
function extractReferralLetterData(
  text: string,
  warnings: string[]
): { data: PatientData; success: boolean } {
  const defaultData: PatientData = {
    firstName: "UNKNOWN",
    lastName: "PATIENT",
    dob: "19000101",
    sex: "U",
  };

  // Extract from RE: line - most reliable pattern
  const patientLineMatch = text.match(REFERRAL_PATTERNS.patientLine);
  let firstName: string | null = null;
  let lastName: string | null = null;
  let dobRaw: string | null = null;

  if (patientLineMatch) {
    // Format 1: "RE: Scott LAWLER" - groups 1, 2
    // Format 2: "RE: LAWLER, Scott" - groups 3, 4
    // DOB is always group 5
    if (patientLineMatch[1] && patientLineMatch[2]) {
      firstName = cleanText(patientLineMatch[1]);
      lastName = cleanText(patientLineMatch[2]);
    } else if (patientLineMatch[3] && patientLineMatch[4]) {
      lastName = cleanText(patientLineMatch[3]);
      firstName = cleanText(patientLineMatch[4]);
    }
    dobRaw = patientLineMatch[5] || null;
  }

  // Extract phone (medium reliability)
  const phone = extractField(text, REFERRAL_PATTERNS_SECONDARY.phone);

  // Extract address (medium reliability)
  let address: string | undefined;
  let suburb: string | undefined;
  let state: string | undefined;
  let postcode: string | undefined;

  const addressMatch = text.match(REFERRAL_PATTERNS_SECONDARY.addressLine);
  if (addressMatch) {
    address = cleanText(addressMatch[1]);
    suburb = cleanText(addressMatch[2]);
    state = cleanText(addressMatch[3]);
    postcode = cleanText(addressMatch[4]);
  }

  // Infer sex from pronouns
  const sex = inferSexFromPronouns(text);

  // Build patient data
  const patientData: PatientData = {
    firstName: firstName || defaultData.firstName,
    lastName: lastName || defaultData.lastName,
    dob: dobRaw ? convertDateToHL7(dobRaw) : defaultData.dob,
    sex,
    phone: phone?.replace(/\s/g, "") || undefined,
    address,
    suburb,
    state: state || (postcode ? inferStateFromPostcode(postcode) : undefined),
    postcode,
  };

  // Add warnings for missing fields
  if (!firstName) warnings.push("Could not extract first name from RE: line");
  if (!lastName) warnings.push("Could not extract last name from RE: line");
  if (!dobRaw) warnings.push("Could not extract date of birth from RE: line");
  if (sex === "U")
    warnings.push("Could not determine sex from pronouns (defaulting to Unknown)");
  if (!phone) warnings.push("Could not extract phone number");
  if (!address) warnings.push("Could not extract address");
  // Note: Medicare not expected in referral letters - no warning

  const success =
    patientData.firstName !== "UNKNOWN" && patientData.lastName !== "PATIENT";

  return { data: patientData, success };
}

/**
 * Extract patient data from PDF - auto-detects document type
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
      return { success: false, data: defaultData, warnings, documentType: "consent_form" };
    }

    // Detect document type
    const documentType = detectDocumentType(text);

    // Extract based on document type
    let result: { data: PatientData; success: boolean };

    if (documentType === "referral_letter") {
      result = extractReferralLetterData(text, warnings);
    } else {
      result = extractConsentFormData(text, warnings);
    }

    return { ...result, warnings, documentType };
  } catch (error) {
    warnings.push(
      `PDF parsing error: ${error instanceof Error ? error.message : "Unknown error"}`
    );
    return { success: false, data: defaultData, warnings, documentType: "consent_form" };
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
