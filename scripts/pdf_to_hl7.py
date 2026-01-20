#!/usr/bin/env python3
"""
PDF to HL7 Converter for Power Automate Desktop
Converts PDF patient consent forms to Australian HL7 v2.4 format (Genie-compatible)

Usage:
    python pdf_to_hl7.py <input_pdf> <output_hl7>
    python pdf_to_hl7.py <input_pdf>  # Outputs to same directory with .hl7 extension

Requirements:
    pip install PyMuPDF  # or: pip install pymupdf

Exit Codes:
    0 - Success
    1 - Invalid arguments
    2 - Input file not found
    3 - PDF parsing error
    4 - Output write error
"""

import sys
import os
import re
import base64
import random
import string
from datetime import datetime
from pathlib import Path
from dataclasses import dataclass, field
from typing import Optional, List, Tuple

# Try to import PDF library
try:
    import fitz  # PyMuPDF
    PDF_LIBRARY = "pymupdf"
except ImportError:
    try:
        import pdfplumber
        PDF_LIBRARY = "pdfplumber"
    except ImportError:
        print("ERROR: No PDF library found. Install one of:")
        print("  pip install PyMuPDF")
        print("  pip install pdfplumber")
        sys.exit(1)


# =============================================================================
# Data Classes
# =============================================================================

@dataclass
class PatientData:
    """Patient information extracted from PDF"""
    first_name: str = "UNKNOWN"
    last_name: str = "PATIENT"
    dob: str = "19000101"  # YYYYMMDD format
    sex: str = "U"  # M, F, or U
    address: Optional[str] = None
    suburb: Optional[str] = None
    state: Optional[str] = None
    postcode: Optional[str] = None
    phone: Optional[str] = None
    medicare_no: Optional[str] = None
    medicare_ref: Optional[str] = None


@dataclass
class HL7Options:
    """HL7 message configuration options"""
    sending_application: str = "MEDIHOST"
    sending_facility: str = "BJCHEALTH"
    receiving_application: str = "GENIE"
    receiving_facility: str = "CLINIC"
    document_title: str = "Patient Consent Form"


@dataclass
class ExtractionResult:
    """Result of patient data extraction"""
    success: bool
    data: PatientData
    warnings: List[str] = field(default_factory=list)


# =============================================================================
# PDF Parser
# =============================================================================

# Regex patterns for BJC Health consent form
PATTERNS = {
    'title': re.compile(r'^\s*(Mr|Mrs|Miss|Ms)\s*$', re.MULTILINE),
    'first_name': re.compile(r'First Name\s*\*?\s*\n?\s*([A-Za-z]+)', re.IGNORECASE),
    'last_name': re.compile(r'Last Name\s*\*?\s*\n?\s*([A-Za-z]+)', re.IGNORECASE),
    'dob': re.compile(r'Date of Birth\s*\*?\s*\n?\s*(\d{1,2}\/\d{1,2}\/\d{4})', re.IGNORECASE),
    'mobile': re.compile(r'Mobile Phone\s*\*?\s*\n?\s*([\d\s]{10,12})', re.IGNORECASE),
    'address': re.compile(r'Address\s*\*?\s*\n?\s*(.+?)(?=\n*Postcode|\n*City)', re.IGNORECASE | re.DOTALL),
    'postcode': re.compile(r'Postcode\s*\*?\s*\n?\s*(\d{4})', re.IGNORECASE),
    'suburb': re.compile(r'City\s*\/?\s*Suburb\s*\*?\s*\n?\s*([A-Za-z\s]+?)(?=\n|State)', re.IGNORECASE),
    'medicare_no': re.compile(r'Medicare Card No\.?\s*\*?\s*\n?\s*(\d{10,11})', re.IGNORECASE),
    'medicare_ref': re.compile(r'Medicare Ref\s*(?:Number)?\s*\*?\s*\n?\s*(\d)', re.IGNORECASE),
}

# Title to sex mapping
TITLE_TO_SEX = {
    'Mr': 'M',
    'Mrs': 'F',
    'Miss': 'F',
    'Ms': 'F',
    'Mx': 'U',
    'Dr': 'U',
}

# Australian postcode first digit to state mapping
POSTCODE_TO_STATE = {
    '2': 'NSW',
    '3': 'VIC',
    '4': 'QLD',
    '5': 'SA',
    '6': 'WA',
    '7': 'TAS',
    '0': 'NT',
}


def extract_text_from_pdf(pdf_path: str) -> str:
    """Extract text from PDF file using available library"""
    if PDF_LIBRARY == "pymupdf":
        doc = fitz.open(pdf_path)
        text = ""
        for page in doc:
            text += page.get_text()
        doc.close()
        return text
    else:  # pdfplumber
        with pdfplumber.open(pdf_path) as pdf:
            text = ""
            for page in pdf.pages:
                page_text = page.extract_text()
                if page_text:
                    text += page_text + "\n"
            return text


def convert_date_to_hl7(date_str: str) -> str:
    """Convert Australian date (DD/MM/YYYY) to HL7 format (YYYYMMDD)"""
    match = re.match(r'(\d{1,2})/(\d{1,2})/(\d{4})', date_str)
    if not match:
        return "19000101"
    day, month, year = match.groups()
    return f"{year}{month.zfill(2)}{day.zfill(2)}"


def infer_state_from_postcode(postcode: str) -> str:
    """Infer Australian state from postcode first digit"""
    if not postcode or len(postcode) != 4:
        return "VIC"  # Default
    return POSTCODE_TO_STATE.get(postcode[0], "VIC")


def extract_field(text: str, pattern: re.Pattern) -> Optional[str]:
    """Extract a single field using regex pattern"""
    match = pattern.search(text)
    if match:
        return match.group(1).strip().replace('\n', ' ').replace('  ', ' ')
    return None


def extract_patient_data(pdf_path: str) -> ExtractionResult:
    """Extract patient data from PDF file"""
    warnings = []
    default_data = PatientData()

    try:
        text = extract_text_from_pdf(pdf_path)

        if not text or not text.strip():
            warnings.append("PDF contains no extractable text")
            return ExtractionResult(success=False, data=default_data, warnings=warnings)

        # Extract all fields
        first_name = extract_field(text, PATTERNS['first_name'])
        last_name = extract_field(text, PATTERNS['last_name'])
        dob_raw = extract_field(text, PATTERNS['dob'])
        mobile = extract_field(text, PATTERNS['mobile'])
        address = extract_field(text, PATTERNS['address'])
        postcode = extract_field(text, PATTERNS['postcode'])
        suburb = extract_field(text, PATTERNS['suburb'])
        medicare_no = extract_field(text, PATTERNS['medicare_no'])
        medicare_ref = extract_field(text, PATTERNS['medicare_ref'])

        # Determine sex from title
        sex = "U"
        title_match = PATTERNS['title'].search(text)
        if title_match:
            sex = TITLE_TO_SEX.get(title_match.group(1), "U")

        # Build patient data
        patient = PatientData(
            first_name=first_name or "UNKNOWN",
            last_name=last_name or "PATIENT",
            dob=convert_date_to_hl7(dob_raw) if dob_raw else "19000101",
            sex=sex,
            phone=mobile.replace(' ', '') if mobile else None,
            address=address,
            suburb=suburb,
            postcode=postcode,
            state=infer_state_from_postcode(postcode) if postcode else None,
            medicare_no=medicare_no.replace(' ', '') if medicare_no else None,
            medicare_ref=medicare_ref,
        )

        # Generate warnings
        if not first_name:
            warnings.append("Could not extract first name")
        if not last_name:
            warnings.append("Could not extract last name")
        if not dob_raw:
            warnings.append("Could not extract date of birth")
        if sex == "U":
            warnings.append("Could not determine sex from title")
        if not medicare_no:
            warnings.append("Could not extract Medicare number")

        success = patient.first_name != "UNKNOWN" and patient.last_name != "PATIENT"
        return ExtractionResult(success=success, data=patient, warnings=warnings)

    except Exception as e:
        warnings.append(f"PDF parsing error: {str(e)}")
        return ExtractionResult(success=False, data=default_data, warnings=warnings)


# =============================================================================
# HL7 Builder
# =============================================================================

FIELD_SEP = "|"
ENCODING_CHARS = "^~\\&"
COMPONENT_SEP = "^"
SEGMENT_TERMINATOR = "\r"  # CR only, no LF


def escape_hl7(value: str) -> str:
    """Escape special characters in HL7 data"""
    return (value
        .replace("\\", "\\E\\")
        .replace("|", "\\F\\")
        .replace("^", "\\S\\")
        .replace("~", "\\R\\")
        .replace("&", "\\T\\"))


def get_hl7_timestamp() -> str:
    """Generate HL7 timestamp in YYYYMMDDHHMMSS format"""
    return datetime.now().strftime("%Y%m%d%H%M%S")


def generate_message_id() -> str:
    """Generate unique message control ID"""
    random_suffix = ''.join(random.choices(string.ascii_uppercase + string.digits, k=4))
    return f"MSG{get_hl7_timestamp()}{random_suffix}"


def build_msh(options: HL7Options) -> str:
    """Build MSH (Message Header) segment"""
    timestamp = get_hl7_timestamp()
    message_id = generate_message_id()

    fields = [
        "MSH",
        ENCODING_CHARS,
        options.sending_application,
        options.sending_facility,
        options.receiving_application,
        options.receiving_facility,
        timestamp,
        "",  # Security
        "ORU^R01",
        message_id,
        "P",  # Processing ID
        "2.4",  # Version
        "",  # Sequence Number
        "",  # Continuation Pointer
        "AL",  # Accept Acknowledgment Type
        "NE",  # Application Acknowledgment Type
        "AUS",  # Country Code
        "8859/1",  # Character Set
    ]
    return FIELD_SEP.join(fields)


def build_pid(patient: PatientData) -> str:
    """Build PID (Patient Identification) segment"""
    # Format Medicare number with reference
    patient_id = ""
    if patient.medicare_no:
        ref = patient.medicare_ref or "1"
        patient_id = f"{patient.medicare_no}-{ref}^^^Medicare^MC"

    # Format address
    address = ""
    if patient.address or patient.suburb:
        address_parts = [
            escape_hl7(patient.address or ""),
            "",  # Street 2
            escape_hl7(patient.suburb or ""),
            patient.state or "VIC",
            patient.postcode or "",
            "AUS",
        ]
        address = COMPONENT_SEP.join(address_parts)

    # Format name: LastName^FirstName
    patient_name = f"{escape_hl7(patient.last_name)}{COMPONENT_SEP}{escape_hl7(patient.first_name)}"

    fields = [
        "PID",
        "1",
        "",  # External ID
        patient_id,
        "",  # Alternate ID
        patient_name,
        "",  # Mother's Maiden Name
        patient.dob,
        patient.sex,
        "",  # Patient Alias
        "",  # Race
        address,
        "",  # County Code
        escape_hl7(patient.phone) if patient.phone else "",
    ]
    return FIELD_SEP.join(fields)


def build_pv1() -> str:
    """Build PV1 (Patient Visit) segment"""
    return FIELD_SEP.join(["PV1", "1", "O"])


def build_obr(options: HL7Options) -> str:
    """Build OBR (Observation Request) segment"""
    timestamp = get_hl7_timestamp()
    report_id = f"RPT{timestamp}^{options.sending_application}"
    service_id = f"PDF^{escape_hl7(options.document_title)}^L"

    fields = ["OBR", "1", "", report_id, service_id]
    fields.extend(["", ""])  # Empty fields
    fields.append(timestamp)  # OBR-7: Observation Date/Time

    # Pad empty fields up to OBR-22
    fields.extend([""] * 14)

    fields.append(timestamp)  # OBR-22: Results Rpt/Status Chng
    fields.extend(["", ""])  # OBR-23, OBR-24
    fields.append("F")  # OBR-25: Result Status

    return FIELD_SEP.join(fields)


def build_obx(pdf_base64: str) -> str:
    """Build OBX (Observation/Result) segment with embedded PDF"""
    observation_id = "PDF^Display format in PDF^AUSPDI"
    observation_value = f"^application^pdf^Base64^{pdf_base64}"

    fields = [
        "OBX",
        "1",
        "ED",
        observation_id,
        "",  # Sub-ID
        observation_value,
        "",  # Units
        "",  # Reference Range
        "",  # Abnormal Flags
        "",  # Probability
        "",  # Nature of Abnormal Test
        "F",  # Result Status
    ]
    return FIELD_SEP.join(fields)


def build_hl7_message(patient: PatientData, pdf_bytes: bytes, options: Optional[HL7Options] = None) -> str:
    """Build complete HL7 message with embedded PDF"""
    if options is None:
        options = HL7Options()

    # Convert PDF to Base64
    pdf_base64 = base64.b64encode(pdf_bytes).decode('ascii')

    # Build all segments
    segments = [
        build_msh(options),
        build_pid(patient),
        build_pv1(),
        build_obr(options),
        build_obx(pdf_base64),
    ]

    # Join with CR only (no LF)
    return SEGMENT_TERMINATOR.join(segments) + SEGMENT_TERMINATOR


def generate_hl7_filename(patient: PatientData) -> str:
    """Generate filename for HL7 file based on patient data"""
    timestamp = get_hl7_timestamp()
    safe_name = re.sub(r'[^a-zA-Z0-9]', '_', f"{patient.last_name}_{patient.first_name}")
    return f"{safe_name}_{timestamp}.hl7"


# =============================================================================
# Main Entry Point
# =============================================================================

def main():
    """Main entry point for command-line execution"""
    # Parse arguments
    if len(sys.argv) < 2:
        print("Usage: python pdf_to_hl7.py <input_pdf> [output_hl7]")
        print("  <input_pdf>   Path to input PDF file")
        print("  [output_hl7]  Optional output path (defaults to input path with .hl7 extension)")
        sys.exit(1)

    input_pdf = sys.argv[1]

    # Validate input file
    if not os.path.exists(input_pdf):
        print(f"ERROR: Input file not found: {input_pdf}")
        sys.exit(2)

    # Determine output path
    if len(sys.argv) >= 3:
        output_hl7 = sys.argv[2]
    else:
        # Same directory, .hl7 extension
        output_hl7 = str(Path(input_pdf).with_suffix('.hl7'))

    print(f"Processing: {input_pdf}")

    # Extract patient data
    try:
        result = extract_patient_data(input_pdf)

        if result.warnings:
            for warning in result.warnings:
                print(f"WARNING: {warning}")

        if result.success:
            print(f"Extracted: {result.data.first_name} {result.data.last_name}")
            print(f"DOB: {result.data.dob}, Sex: {result.data.sex}")
            if result.data.medicare_no:
                print(f"Medicare: {result.data.medicare_no}-{result.data.medicare_ref or '1'}")
        else:
            print("WARNING: Partial extraction - using default values for missing fields")

    except Exception as e:
        print(f"ERROR: Failed to extract patient data: {e}")
        sys.exit(3)

    # Read PDF file for embedding
    try:
        with open(input_pdf, 'rb') as f:
            pdf_bytes = f.read()
    except Exception as e:
        print(f"ERROR: Failed to read PDF file: {e}")
        sys.exit(3)

    # Build HL7 message
    try:
        hl7_message = build_hl7_message(result.data, pdf_bytes)
    except Exception as e:
        print(f"ERROR: Failed to build HL7 message: {e}")
        sys.exit(3)

    # Write output file
    try:
        with open(output_hl7, 'w', encoding='utf-8', newline='') as f:
            f.write(hl7_message)
        print(f"Output: {output_hl7}")
        print(f"Size: {len(hl7_message):,} bytes")
        print("SUCCESS")
    except Exception as e:
        print(f"ERROR: Failed to write output file: {e}")
        sys.exit(4)

    sys.exit(0)


if __name__ == "__main__":
    main()
