/**
 * Generate dummy referral letter PDF for testing
 * Uses Puppeteer to render HTML to PDF
 *
 * Run with: bun scripts/generate-test-pdf.ts
 */

import puppeteer from "puppeteer";
import path from "path";
import fs from "fs";

const DUMMY_DATA = {
  // Patient
  patientFirstName: "John",
  patientLastName: "SMITH",
  patientDob: "15/06/1980",
  patientAddress: "42 Example Street",
  patientSuburb: "SYDNEY",
  patientState: "NSW",
  patientPostcode: "2000",
  patientMobile: "0400 000 000",
  claimNo: "9999999",

  // Recipient (GP)
  recipientTitle: "Dr",
  recipientName: "Jane Doe",
  recipientPractice: "Sydney Medical Centre",
  recipientAddress1: "Suite 1, Level 2",
  recipientAddress2: "123 Main Street",
  recipientSuburb: "SYDNEY",
  recipientState: "NSW",
  recipientPostcode: "2000",

  // Author (Specialist)
  authorTitle: "Dr",
  authorName: "Test Doctor",
  authorSpecialty: "Specialist Physician",
  authorProviderNo: "123456AB",
  practiceName: "Test Specialist Clinic",
  practiceAddress: "Suite 10, Level 5, Test Hospital, 100 Hospital Road",
  practiceSuburb: "SYDNEY",
  practiceState: "NSW",
  practicePostcode: "2000",
  practicePhone: "02 1234 5678",
  practiceFax: "02 1234 5679",

  // Letter
  letterDate: "21 January 2026",
  diagnosis: "Follow-up consultation post procedure",
};

const HTML_TEMPLATE = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    @page {
      margin: 2cm;
      size: A4;
    }
    body {
      font-family: Arial, sans-serif;
      font-size: 11pt;
      line-height: 1.4;
      color: #333;
    }
    .header {
      border-bottom: 2px solid #0099cc;
      padding-bottom: 15px;
      margin-bottom: 20px;
    }
    .clinic-name {
      font-size: 24pt;
      font-weight: bold;
      color: #0099cc;
      margin-bottom: 5px;
    }
    .clinic-tagline {
      font-size: 9pt;
      color: #666;
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    .contact-info {
      text-align: right;
      font-size: 9pt;
      color: #666;
      margin-top: -40px;
    }
    .date {
      text-align: right;
      margin: 20px 0;
    }
    .recipient-block {
      margin-bottom: 20px;
    }
    .salutation {
      margin: 20px 0;
    }
    .re-line {
      margin: 15px 0;
      padding: 10px;
      background: #f5f5f5;
      border-left: 3px solid #0099cc;
    }
    .re-line strong {
      color: #0099cc;
    }
    .patient-details {
      margin-left: 50px;
    }
    .body-text {
      margin: 20px 0;
      text-align: justify;
    }
    .body-text p {
      margin-bottom: 12px;
    }
    .diagnosis {
      margin: 15px 0;
    }
    .diagnosis strong {
      color: #333;
    }
    .signature-block {
      margin-top: 40px;
    }
    .signature-line {
      margin-top: 50px;
      border-top: 1px solid #333;
      width: 200px;
    }
    .author-name {
      font-weight: bold;
      margin-top: 5px;
    }
    .author-details {
      font-size: 10pt;
      color: #666;
    }
    .footer {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      text-align: center;
      font-size: 8pt;
      color: #999;
      border-top: 1px solid #ddd;
      padding-top: 10px;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="clinic-name">${DUMMY_DATA.practiceName}</div>
    <div class="clinic-tagline">Specialist Medical Care</div>
    <div class="contact-info">
      ${DUMMY_DATA.practiceAddress}<br>
      ${DUMMY_DATA.practiceSuburb} ${DUMMY_DATA.practiceState} ${DUMMY_DATA.practicePostcode}<br>
      T. ${DUMMY_DATA.practicePhone} | F. ${DUMMY_DATA.practiceFax}
    </div>
  </div>

  <div class="date">${DUMMY_DATA.letterDate}</div>

  <div class="recipient-block">
    ${DUMMY_DATA.recipientTitle} ${DUMMY_DATA.recipientName}<br>
    ${DUMMY_DATA.recipientPractice}<br>
    ${DUMMY_DATA.recipientAddress1}<br>
    ${DUMMY_DATA.recipientAddress2}<br>
    ${DUMMY_DATA.recipientSuburb} ${DUMMY_DATA.recipientState} ${DUMMY_DATA.recipientPostcode}
  </div>

  <div class="salutation">Dear ${DUMMY_DATA.recipientTitle} ${DUMMY_DATA.recipientName.split(" ").pop()}</div>

  <div class="re-line">
    <strong>RE:</strong> ${DUMMY_DATA.patientFirstName} ${DUMMY_DATA.patientLastName} - DOB: ${DUMMY_DATA.patientDob}
    <div class="patient-details">
      ${DUMMY_DATA.patientAddress}, ${DUMMY_DATA.patientSuburb}, ${DUMMY_DATA.patientState}, ${DUMMY_DATA.patientPostcode}<br>
      Mobile: ${DUMMY_DATA.patientMobile}<br>
      Claim No: ${DUMMY_DATA.claimNo}
    </div>
  </div>

  <div class="body-text">
    <p>Thank you for your ongoing care of ${DUMMY_DATA.patientFirstName} whom I reviewed today in rooms for follow-up.</p>

    <div class="diagnosis">
      <strong>Provisional Diagnosis:</strong> ${DUMMY_DATA.diagnosis}
    </div>

    <p>It was a pleasure to see ${DUMMY_DATA.patientFirstName} again today. He reports that his symptoms have been improving steadily since his last appointment.</p>

    <p>On examination, he appears well and his vital signs are within normal limits. The wound sites have healed well with no signs of infection or complications.</p>

    <p>I have advised him to continue with his current medication regimen and to maintain regular follow-up appointments with you. He should return to see me in three months for a routine review.</p>

    <p>I have recommended that he gradually increase his physical activity as tolerated and to contact your practice if he experiences any concerning symptoms in the interim.</p>

    <p>Please do not hesitate to contact me if you have any questions regarding his ongoing management.</p>
  </div>

  <div class="signature-block">
    <p>Yours Sincerely</p>
    <div class="signature-line"></div>
    <div class="author-name">${DUMMY_DATA.authorTitle} ${DUMMY_DATA.authorName}</div>
    <div class="author-details">
      ${DUMMY_DATA.authorSpecialty}<br>
      Provider No: ${DUMMY_DATA.authorProviderNo}
    </div>
  </div>

  <div class="footer">
    This letter is intended for the exclusive use of the addressee. It may contain privileged or confidential information.
  </div>
</body>
</html>
`;

async function generatePDF() {
  console.log("Launching browser...");
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  console.log("Rendering HTML...");
  await page.setContent(HTML_TEMPLATE, { waitUntil: "networkidle0" });

  const outputDir = path.join(__dirname, "../docs/input PDF");
  const outputPath = path.join(outputDir, "Referral_dummy.pdf");

  // Create directory if it doesn't exist
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
    console.log(`Created directory: ${outputDir}`);
  }

  console.log(`Generating PDF at: ${outputPath}`);
  await page.pdf({
    path: outputPath,
    format: "A4",
    printBackground: true,
    margin: {
      top: "0",
      right: "0",
      bottom: "0",
      left: "0",
    },
  });

  await browser.close();
  console.log("Done! PDF generated successfully.");
  console.log("\nDummy data used:");
  console.log(`  Patient: ${DUMMY_DATA.patientFirstName} ${DUMMY_DATA.patientLastName}`);
  console.log(`  DOB: ${DUMMY_DATA.patientDob}`);
  console.log(`  Address: ${DUMMY_DATA.patientAddress}, ${DUMMY_DATA.patientSuburb}, ${DUMMY_DATA.patientState}, ${DUMMY_DATA.patientPostcode}`);
  console.log(`  Mobile: ${DUMMY_DATA.patientMobile}`);
}

generatePDF().catch(console.error);
