import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PDF to HL7 Converter",
  description: "Convert PDF files to HL7 v2.4 format with embedded PDF for Genie",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased min-h-screen bg-gray-50">
        {children}
      </body>
    </html>
  );
}
