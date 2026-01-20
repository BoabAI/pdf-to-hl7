# PDF to HL7 Converter

Convert PDF patient consent forms to Australian HL7 v2.4 format (Genie-compatible).

## Features

- Upload PDF consent forms via web interface or API
- Extract patient data (name, DOB, address, Medicare number)
- Generate HL7 v2.4 ORU^R01 messages per ADRM specification
- Embed original PDF as Base64 in OBX segment
- Download generated HL7 files

## Quick Start

```bash
# Install dependencies
bun install

# Start development server
bun dev

# Open http://localhost:3000
```

## API Usage

### Health Check

```bash
curl http://localhost:3000/api/convert
```

### Convert PDF to HL7

```bash
curl -X POST \
  -F "pdf=@/path/to/consent-form.pdf" \
  http://localhost:3000/api/convert
```

**Response:**
```json
{
  "success": true,
  "filename": "SMITH_JOHN_20250120_123456.hl7",
  "hl7Content": "MSH|^~\\&|...",
  "extractedData": {
    "patientName": "SMITH^JOHN",
    "dateOfBirth": "19850315",
    "medicare": "1234567890^1"
  },
  "warnings": []
}
```

## HL7 Output Format

The converter generates Australian HL7 v2.4 ORU^R01 messages with:

| Segment | Description |
|---------|-------------|
| MSH | Message header with AUS country code, 8859/1 charset |
| PID | Patient identification with Medicare format |
| PV1 | Patient visit (Outpatient) |
| OBR | Observation request |
| OBX | Embedded PDF as Base64 in ED datatype |

### Example Output

```
MSH|^~\&|PDF_CONVERTER|BJC_HEALTH|GENIE|CLINIC|20250120123456||ORU^R01|MSG123|P|2.4|||AL|NE||AUS|8859/1
PID|1||^^^Medicare^MC~^^^MRN||SMITH^JOHN||19850315|M|||123 Main St^^Sydney^NSW^2000^AUS
PV1|1|O|^^^BJC_HEALTH||||||||||||||||V123
OBR|1||ORD123|PDF^Patient Consent Form^AUSPDI|||20250120123456
OBX|1|ED|PDF^Consent Document^AUSPDI||^application^pdf^Base64^<base64_data>||||||F
```

## Deployment

### AWS Amplify

1. Connect your GitHub repository to AWS Amplify
2. Amplify will auto-detect Next.js and use `amplify.yml`
3. Set platform to **WEB_COMPUTE** for SSR support

```bash
# Manual build test
bun run build
```

## Tech Stack

- **Next.js 14** - App Router with Server Components
- **TypeScript** - Type-safe development
- **Tailwind CSS** - Styling
- **pdf-parse** - PDF text extraction
- **AWS Amplify** - Hosting with SSR support

## Project Structure

```
├── app/
│   ├── api/convert/route.ts  # API endpoint
│   ├── page.tsx              # Upload UI
│   └── layout.tsx            # Root layout
├── lib/
│   ├── pdf-parser.ts         # PDF data extraction
│   ├── hl7-builder.ts        # HL7 message generation
│   └── utils.ts              # Utility functions
└── amplify.yml               # AWS Amplify config
```

## License

Private - All rights reserved.
