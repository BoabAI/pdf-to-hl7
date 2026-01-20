/**
 * HL7 v2.4 Message Builder for Australian Pathology (Genie-compatible)
 * Based on Australian Diagnostics and Referral Messaging (ADRM) specification
 */

export interface PatientData {
  firstName: string;
  lastName: string;
  dob: string; // YYYYMMDD format
  sex: "M" | "F" | "U";
  address?: string;
  suburb?: string;
  state?: string;
  postcode?: string;
  phone?: string;
  medicareNo?: string;
  medicareRef?: string;
}

export interface HL7Options {
  sendingApplication?: string;
  sendingFacility?: string;
  receivingApplication?: string;
  receivingFacility?: string;
  documentTitle?: string;
}

const DEFAULT_OPTIONS: HL7Options = {
  sendingApplication: "MEDIHOST",
  sendingFacility: "BJCHEALTH",
  receivingApplication: "GENIE",
  receivingFacility: "CLINIC",
  documentTitle: "Patient Consent Form",
};

// HL7 field separator and encoding characters
const FIELD_SEP = "|";
const ENCODING_CHARS = "^~\\&";
const COMPONENT_SEP = "^";
const SEGMENT_TERMINATOR = "\r"; // CR only, no LF

/**
 * Escape special characters in HL7 data
 */
function escapeHL7(value: string): string {
  return value
    .replace(/\\/g, "\\E\\") // Escape character first
    .replace(/\|/g, "\\F\\") // Field separator
    .replace(/\^/g, "\\S\\") // Component separator
    .replace(/~/g, "\\R\\") // Repetition separator
    .replace(/&/g, "\\T\\"); // Subcomponent separator
}

/**
 * Generate HL7 timestamp in YYYYMMDDHHMMSS format
 */
function getHL7Timestamp(): string {
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  return (
    now.getFullYear().toString() +
    pad(now.getMonth() + 1) +
    pad(now.getDate()) +
    pad(now.getHours()) +
    pad(now.getMinutes()) +
    pad(now.getSeconds())
  );
}

/**
 * Generate unique message control ID
 */
function generateMessageId(): string {
  return `MSG${getHL7Timestamp()}${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
}

/**
 * Build MSH (Message Header) segment
 */
function buildMSH(options: HL7Options): string {
  const timestamp = getHL7Timestamp();
  const messageId = generateMessageId();

  // MSH-1: Field Separator (|)
  // MSH-2: Encoding Characters (^~\&)
  // MSH-3: Sending Application
  // MSH-4: Sending Facility
  // MSH-5: Receiving Application
  // MSH-6: Receiving Facility
  // MSH-7: Date/Time of Message
  // MSH-8: Security (empty)
  // MSH-9: Message Type (ORU^R01)
  // MSH-10: Message Control ID
  // MSH-11: Processing ID (P=Production)
  // MSH-12: Version ID (2.4)
  // MSH-13-14: empty
  // MSH-15: Accept Acknowledgment Type (AL)
  // MSH-16: Application Acknowledgment Type (NE)
  // MSH-17: Country Code (AUS)
  // MSH-18: Character Set (8859/1)

  return [
    "MSH",
    ENCODING_CHARS,
    options.sendingApplication,
    options.sendingFacility,
    options.receivingApplication,
    options.receivingFacility,
    timestamp,
    "", // Security
    "ORU^R01",
    messageId,
    "P",
    "2.4",
    "", // Sequence Number
    "", // Continuation Pointer
    "AL",
    "NE",
    "AUS",
    "8859/1",
  ].join(FIELD_SEP);
}

/**
 * Build PID (Patient Identification) segment
 */
function buildPID(patient: PatientData): string {
  // Format Medicare number with reference
  let patientId = "";
  if (patient.medicareNo) {
    const ref = patient.medicareRef || "1";
    patientId = `${patient.medicareNo}-${ref}^^^Medicare^MC`;
  }

  // Format address
  let address = "";
  if (patient.address || patient.suburb) {
    address = [
      escapeHL7(patient.address || ""),
      "", // Street 2
      escapeHL7(patient.suburb || ""),
      patient.state || "VIC",
      patient.postcode || "",
      "AUS",
    ].join(COMPONENT_SEP);
  }

  // Format name: LastName^FirstName
  const patientName = `${escapeHL7(patient.lastName)}^${escapeHL7(patient.firstName)}`;

  // PID-1: Set ID
  // PID-2: Patient ID (External) - empty
  // PID-3: Patient Identifier List
  // PID-4: Alternate Patient ID - empty
  // PID-5: Patient Name
  // PID-6: Mother's Maiden Name - empty
  // PID-7: Date of Birth
  // PID-8: Sex
  // PID-9-10: empty
  // PID-11: Patient Address
  // PID-12: empty
  // PID-13: Phone Number (Home)

  return [
    "PID",
    "1",
    "", // External ID
    patientId,
    "", // Alternate ID
    patientName,
    "", // Mother's Maiden Name
    patient.dob,
    patient.sex,
    "", // Patient Alias
    "", // Race
    address,
    "", // County Code
    patient.phone ? escapeHL7(patient.phone) : "",
  ].join(FIELD_SEP);
}

/**
 * Build PV1 (Patient Visit) segment
 */
function buildPV1(): string {
  // Minimal PV1 for outpatient document
  // PV1-1: Set ID
  // PV1-2: Patient Class (O = Outpatient)
  return ["PV1", "1", "O"].join(FIELD_SEP);
}

/**
 * Build OBR (Observation Request) segment
 */
function buildOBR(options: HL7Options): string {
  const timestamp = getHL7Timestamp();
  const reportId = `RPT${timestamp}^${options.sendingApplication}`;
  const serviceId = `PDF^${escapeHL7(options.documentTitle || "PDF Report")}^L`;

  // OBR-1: Set ID
  // OBR-2: Placer Order Number - empty
  // OBR-3: Filler Order Number
  // OBR-4: Universal Service Identifier
  // OBR-5-6: empty
  // OBR-7: Observation Date/Time
  // OBR-8-24: mostly empty
  // OBR-25: Result Status (F = Final)

  const fields = ["OBR", "1", "", reportId, serviceId];

  // Pad empty fields up to OBR-7
  fields.push("", "");
  fields.push(timestamp); // OBR-7

  // Pad empty fields up to OBR-22
  for (let i = 0; i < 14; i++) {
    fields.push("");
  }

  fields.push(timestamp); // OBR-22: Results Rpt/Status Chng
  fields.push("", ""); // OBR-23, OBR-24
  fields.push("F"); // OBR-25: Result Status

  return fields.join(FIELD_SEP);
}

/**
 * Build OBX (Observation/Result) segment with embedded PDF
 */
function buildOBX(pdfBase64: string): string {
  // OBX-1: Set ID
  // OBX-2: Value Type (ED = Encapsulated Data)
  // OBX-3: Observation Identifier (AUSPDI format)
  // OBX-4: Observation Sub-ID - empty
  // OBX-5: Observation Value (ED format: ^application^pdf^Base64^<data>)
  // OBX-6-10: empty
  // OBX-11: Observation Result Status (F = Final)

  const observationId = "PDF^Display format in PDF^AUSPDI";

  // ED format: source^type^subtype^encoding^data
  // For PDF: ^application^pdf^Base64^<base64data>
  const observationValue = `^application^pdf^Base64^${pdfBase64}`;

  return [
    "OBX",
    "1",
    "ED",
    observationId,
    "", // Sub-ID
    observationValue,
    "", // Units
    "", // Reference Range
    "", // Abnormal Flags
    "", // Probability
    "", // Nature of Abnormal Test
    "F", // Result Status
  ].join(FIELD_SEP);
}

/**
 * Build complete HL7 message with embedded PDF
 */
export function buildHL7Message(
  patient: PatientData,
  pdfBuffer: Buffer,
  options: Partial<HL7Options> = {}
): string {
  const mergedOptions = { ...DEFAULT_OPTIONS, ...options };

  // Convert PDF to Base64 (no line breaks or spaces)
  const pdfBase64 = pdfBuffer.toString("base64");

  // Build all segments
  const segments = [
    buildMSH(mergedOptions),
    buildPID(patient),
    buildPV1(),
    buildOBR(mergedOptions),
    buildOBX(pdfBase64),
  ];

  // Join segments with CR (carriage return) only - no LF
  return segments.join(SEGMENT_TERMINATOR) + SEGMENT_TERMINATOR;
}

/**
 * Generate filename for HL7 file based on patient data
 */
export function generateHL7Filename(patient: PatientData): string {
  const timestamp = getHL7Timestamp();
  const safeName = `${patient.lastName}_${patient.firstName}`.replace(/[^a-zA-Z0-9]/g, "_");
  return `${safeName}_${timestamp}.hl7`;
}
