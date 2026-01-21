# Referral Letter PDF Support

This document describes the referral letter extraction feature added to the PDF to HL7 converter.

## Overview

The application now supports three document types:
1. **BJC Health Consent Forms** - Original support
2. **Specialist Referral Letters** - NeuroSpine Clinic format (`RE: Name - DOB:`)
3. **GP Referral Letters** - Best Practice/Medical Director format (`re. Mr Name`)

## Document Type Detection

### Auto-Detection Logic

The system automatically detects document type by looking for patterns:

```
if (text contains "Dear Dr/Professor" OR "Dear [Name]," AND text contains "RE:" or "re.") {
  → Referral Letter
} else {
  → Consent Form
}
```

### Manual Override

Users can manually select the document type via a dropdown in the UI:
- **Auto-detect** (default)
- **Consent Form**
- **Referral Letter**

## Data Extraction

### Specialist Referral Letter Extraction (NeuroSpine format)

| Field | Source Pattern | Reliability |
|-------|----------------|-------------|
| Patient Name | `RE: FirstName LASTNAME - DOB:` | High |
| DOB | `DOB: DD/MM/YYYY` on RE: line | High |
| Sex | Pronoun inference (he/him/his or she/her/hers) | Medium |
| Phone | `Mobile:`, `Ph:`, `Tel:` patterns | Medium |
| Address | Structured address line after RE: | Medium |
| Provider No | `Provider No: NNNNNNXX` | High |

**Note:** Medicare numbers are NOT expected in specialist referral letters.

### GP Referral Letter Extraction (Best Practice format)

| Field | Source Pattern | Reliability |
|-------|----------------|-------------|
| Patient Name | `re. Mr Tim Ball` (title + name) | High |
| DOB | `DOB: DD/MM/YYYY` on separate line | High |
| Sex | Title (Mr/Mrs/Miss/Ms) | High |
| Phone | `Mobile: NNNN NNN NNN` | High |
| Address | Multi-line format after DOB | High |
| Medicare | `Medicare No: NNNNNNNNNN` | High |
| Provider No | `NNNNNNXX` after signature | Medium |

**Note:** GP letters typically include Medicare numbers.

### Consent Form Extraction

| Field | Source Pattern |
|-------|----------------|
| Patient Name | `First Name` / `Last Name` form fields |
| DOB | `Date of Birth` field |
| Sex | Title (Mr/Mrs/Miss/Ms) |
| Phone | `Mobile Phone` field |
| Address | Address, Postcode, City/Suburb fields |
| Medicare | `Medicare Card No` + `Medicare Ref` fields |

## HL7 Output

Both document types generate the same HL7 v2.4 ORU^R01 message format:

```
MSH|^~\&|MEDIHOST|BJCHEALTH|GENIE|CLINIC|...
PID|1||...|LASTNAME^FirstName||YYYYMMDD|M/F/U|...
PV1|1|O|...
OBR|1||...|PDF^Document Title^L|...
OBX|1|ED|PDF^Display format in PDF^AUSPDI||^application^pdf^Base64^<PDF_DATA>|...
```

The original PDF is embedded as Base64 in the OBX segment.

## API Usage

### Request

```bash
curl -X POST \
  -F "pdf=@letter.pdf" \
  -F "documentType=auto" \
  -F "autoFile=true" \
  http://localhost:3000/api/convert
```

**Parameters:**
- `pdf` (required): The PDF file
- `documentType` (optional): `auto`, `consent_form`, or `referral_letter`
- `autoFile` (optional): `true` for Final status, `false` for Preliminary
- `orderingProvider` (optional): Medicare Provider Number for routing

### Response

```json
{
  "success": true,
  "filename": "SMITH_John_20260121120000.hl7",
  "hl7Content": "MSH|^~\\&|...",
  "extractedData": {
    "firstName": "John",
    "lastName": "SMITH",
    "dob": "15/06/1980",
    "sex": "Male",
    "medicareNo": "Not provided"
  },
  "warnings": []
}
```

## Test PDFs

Test PDFs are stored in `docs/input PDF/`:
- `Referral_dummy.pdf` - Generated dummy specialist referral letter (safe to commit)
- `BP2026012137327.pdf` - GP referral letter (Best Practice format)
- `Patient_Information_and_Consent_Form_*.pdf` - Consent form (gitignored - contains patient data)

### Generating Test PDFs

```bash
bun scripts/generate-test-pdf.ts
```

This creates a dummy referral letter with fake patient data for testing.

## File Changes

| File | Purpose |
|------|---------|
| `lib/pdf-parser.ts` | Document detection + extraction patterns |
| `app/api/convert/route.ts` | Accept documentType parameter |
| `app/page.tsx` | Document type dropdown UI |
| `scripts/generate-test-pdf.ts` | Puppeteer script for test PDFs |
| `lib/pdf-parser.test.ts` | Extraction tests |
