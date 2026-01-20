# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build Commands

```bash
bun dev          # Start development server (localhost:3000)
bun run build    # Production build
bun run lint     # ESLint check
bun start        # Start production server
```

## Testing the API

```bash
# Health check
curl http://localhost:3000/api/convert

# Convert PDF to HL7
curl -X POST -F "pdf=@/path/to/file.pdf" http://localhost:3000/api/convert
```

## Architecture

This is a Next.js 14 App Router application that converts PDF patient consent forms to Australian HL7 v2.4 format (Genie-compatible).

### Data Flow

```
PDF Upload → /api/convert → pdf-parser.ts → hl7-builder.ts → HL7 Download
```

### Core Modules

**`lib/pdf-parser.ts`** - Extracts patient data from BJC Health consent forms using regex patterns. Handles:
- Patient name, DOB, address from form fields
- Medicare number/ref extraction
- State inference from Australian postcodes (first digit → state)
- Falls back to placeholder values ("UNKNOWN^PATIENT") if extraction fails

**`lib/hl7-builder.ts`** - Generates Australian HL7 v2.4 ORU^R01 messages per ADRM specification:
- MSH: Message header with AUS country code, 8859/1 charset
- PID: Patient identification with Medicare format
- PV1: Patient visit (Outpatient)
- OBR: Observation request
- OBX: Embedded PDF as Base64 in ED datatype with AUSPDI coding

### HL7 Format Notes

- Segment terminator: CR only (`\r`), no LF
- Special characters must be escaped: `|` → `\F\`, `^` → `\S\`, etc.
- PDF embedded in OBX-5: `^application^pdf^Base64^<data>`
- Date format: YYYYMMDD (converted from Australian DD/MM/YYYY)

## Deployment

Deploy to AWS Amplify with platform set to **WEB_COMPUTE** (required for SSR). The `amplify.yml` is pre-configured. Uses `output: "standalone"` in next.config.mjs for Amplify compatibility.
