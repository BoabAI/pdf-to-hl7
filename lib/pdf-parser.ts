/**
 * PDF Text Extractor and Patient Data Parser
 * Supports:
 * - BJC Health Patient Information and Consent Form
 * - Specialist Referral Letters (e.g., from NeuroSpine Clinic)
 */

import pdf from "pdf-parse";
import type { PatientData } from "./hl7-builder";

// Document types supported
export type DocumentType = "consent_form" | "referral_letter" | "gp_referral";

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

  // Address line after RE: line (NeuroSpine format)
  // Matches: "104 Stratford Road, TAHMOOR, NSW, 2573"
  addressLine:
    /^\s*(\d+[^,\n]+),\s*([A-Z][A-Za-z\s]+),\s*([A-Z]{2,3}),?\s*(\d{4})\s*$/m,
};

// GP/Best Practice referral letter patterns
const GP_REFERRAL_PATTERNS = {
  // "re. Mr Tim Ball" or "re. Mrs Jane Smith" - title + name format
  // Captures: (1) title, (2) first name, (3) last name
  patientLineWithTitle: /\bre\.?\s+(Mr|Mrs|Miss|Ms|Dr)\s+([A-Za-z]+)\s+([A-Za-z]+)/i,

  // DOB on separate line: "DOB: 18/09/1968"
  dobLine: /\bDOB:\s*(\d{1,2}\/\d{1,2}\/\d{4})/i,

  // Medicare No: 2673291844 (GP letters often include this)
  medicareNo: /Medicare\s*No[:\s]+(\d{10,11})/i,

  // Mobile on separate line: "Mobile: 0468 900 291"
  mobile: /Mobile:\s*([\d\s]{10,14})/i,

  // Multi-line address pattern (GP format)
  // Line 1: "274/4 The Crescent"
  // Line 2: "Wentworth Point. 2127" or "Wentworth Point NSW 2127"
  addressBlock: /(?:Medicare|Mobile)[^\n]*\n[\s\S]*?(\d+[\w\/]+\s+[^\n]+)\n([A-Za-z\s]+)[.\s]+(\d{4})/i,

  // Simpler address: just grab the line with a postcode after patient details
  addressWithPostcode: /^\s*(.+?)[.\s]+(\d{4})\s*$/m,

  // Provider number at signature (no label): "567612EL" on its own line
  providerNoStandalone: /^\s*(\d{6}[A-Z]{2})\s*$/m,
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
  // Referral letters have "Dear Dr" or "Dear [Name]," and "RE:" or "re." patterns
  const hasDearDr = /Dear\s+(?:Dr|Professor)/i.test(text);
  const hasDearName = /Dear\s+[A-Z][a-z]+,/m.test(text); // "Dear Elaine,"
  const hasReLine = /\b(?:RE|re)[:\.]?\s+/i.test(text); // RE: or re. or re

  if ((hasDearDr || hasDearName) && hasReLine) {
    // Distinguish between specialist and GP referral formats
    // GP format: "re. Mr Tim Ball" (lowercase re., title + name)
    const isGPFormat = /\bre\.?\s+(?:Mr|Mrs|Miss|Ms|Dr)\s+[A-Za-z]+\s+[A-Za-z]+/i.test(text);
    // GP format also has Medicare No
    const hasMedicareNo = /Medicare\s*No[:\s]+\d{10,11}/i.test(text);

    if (isGPFormat || hasMedicareNo) {
      return "gp_referral";
    }
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
 * Supports two formats:
 * 1. NeuroSpine format: "RE: FirstName LASTNAME - DOB: DD/MM/YYYY"
 * 2. GP/Best Practice format: "re. Mr Tim Ball" with DOB on separate line
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

  let firstName: string | null = null;
  let lastName: string | null = null;
  let dobRaw: string | null = null;
  let sex: "M" | "F" | "U" = "U";
  let medicareNo: string | undefined;
  let medicareRef: string | undefined;

  // Try NeuroSpine format first: "RE: Scott LAWLER - DOB: DD/MM/YYYY"
  const patientLineMatch = text.match(REFERRAL_PATTERNS.patientLine);
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
    // Infer sex from pronouns for NeuroSpine format
    sex = inferSexFromPronouns(text);
  }

  // Try GP/Best Practice format if NeuroSpine didn't work: "re. Mr Tim Ball"
  if (!firstName || !lastName) {
    const gpPatientMatch = text.match(GP_REFERRAL_PATTERNS.patientLineWithTitle);
    if (gpPatientMatch) {
      const title = gpPatientMatch[1];
      firstName = cleanText(gpPatientMatch[2]);
      lastName = cleanText(gpPatientMatch[3]);
      // Use title to determine sex (more reliable than pronouns)
      sex = TITLE_TO_SEX[title] || "U";
    }
  }

  // Extract DOB from separate line if not found in RE: line (GP format)
  if (!dobRaw) {
    const dobMatch = text.match(GP_REFERRAL_PATTERNS.dobLine);
    if (dobMatch) {
      dobRaw = dobMatch[1];
    }
  }

  // Extract Medicare (GP letters often include this)
  const medicareMatch = text.match(GP_REFERRAL_PATTERNS.medicareNo);
  if (medicareMatch) {
    const fullMedicare = medicareMatch[1];
    // Medicare format: 10 digits + optional 1 digit ref
    if (fullMedicare.length === 11) {
      medicareNo = fullMedicare.substring(0, 10);
      medicareRef = fullMedicare.substring(10);
    } else {
      medicareNo = fullMedicare;
    }
  }

  // Extract phone - try GP format first, then general pattern
  let phone = extractField(text, GP_REFERRAL_PATTERNS.mobile);
  if (!phone) {
    phone = extractField(text, REFERRAL_PATTERNS_SECONDARY.phone);
  }

  // Extract address
  let address: string | undefined;
  let suburb: string | undefined;
  let state: string | undefined;
  let postcode: string | undefined;

  // Try NeuroSpine single-line format first
  const addressMatch = text.match(REFERRAL_PATTERNS_SECONDARY.addressLine);
  if (addressMatch) {
    address = cleanText(addressMatch[1]);
    suburb = cleanText(addressMatch[2]);
    state = cleanText(addressMatch[3]);
    postcode = cleanText(addressMatch[4]);
  }

  // Try GP multi-line format if single-line didn't work
  if (!address) {
    // Look for address pattern after patient details
    // Pattern: street line, then suburb. postcode
    const gpAddressMatch = text.match(
      /(?:re\.[^\n]+\n.*?DOB:[^\n]+\n)([^\n]+)\n([A-Za-z\s]+)[.\s]+(\d{4})/is
    );
    if (gpAddressMatch) {
      address = cleanText(gpAddressMatch[1]);
      suburb = cleanText(gpAddressMatch[2]);
      postcode = cleanText(gpAddressMatch[3]);
      state = inferStateFromPostcode(postcode);
    }
  }

  // Fall back to inferring sex from pronouns if title didn't help
  if (sex === "U") {
    sex = inferSexFromPronouns(text);
  }

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
    medicareNo,
    medicareRef,
  };

  // Add warnings for missing fields
  if (!firstName) warnings.push("Could not extract first name from referral");
  if (!lastName) warnings.push("Could not extract last name from referral");
  if (!dobRaw) warnings.push("Could not extract date of birth from referral");
  if (sex === "U")
    warnings.push("Could not determine sex (defaulting to Unknown)");
  if (!phone) warnings.push("Could not extract phone number");
  if (!address) warnings.push("Could not extract address");
  // Note: Medicare IS expected in GP letters but not specialist letters

  const success =
    patientData.firstName !== "UNKNOWN" && patientData.lastName !== "PATIENT";

  return { data: patientData, success };
}

/**
 * Extract patient data from PDF
 * @param pdfBuffer - The PDF file as a Buffer
 * @param forceDocumentType - Optional: force a specific document type instead of auto-detecting
 *                           "auto" or undefined = auto-detect
 */
export async function extractPatientData(
  pdfBuffer: Buffer,
  forceDocumentType?: DocumentType | "auto"
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

    // Determine document type (auto-detect or use forced type)
    const documentType: DocumentType =
      forceDocumentType && forceDocumentType !== "auto"
        ? forceDocumentType
        : detectDocumentType(text);

    // Extract based on document type
    let result: { data: PatientData; success: boolean };

    if (documentType === "referral_letter" || documentType === "gp_referral") {
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
