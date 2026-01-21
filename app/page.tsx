"use client";

import { useState, useCallback } from "react";
import Image from "next/image";

interface ConversionResult {
  success: boolean;
  filename?: string;
  hl7Content?: string;
  extractedData?: {
    firstName: string;
    lastName: string;
    dob: string;
    sex: string;
    medicareNo: string;
  };
  error?: string;
}

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const [result, setResult] = useState<ConversionResult | null>(null);
  // Document type selection
  const [documentType, setDocumentType] = useState<"auto" | "consent_form" | "referral_letter">("auto");
  // Genie HL7 action options
  const [autoFile, setAutoFile] = useState(true);
  const [sendToDoctor, setSendToDoctor] = useState(false);
  const [providerNumber, setProviderNumber] = useState("");

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile?.type === "application/pdf") {
      setFile(droppedFile);
      setResult(null);
    } else {
      alert("Please upload a PDF file");
    }
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      setResult(null);
    }
  };

  const handleConvert = async () => {
    if (!file) return;

    setIsConverting(true);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append("pdf", file);
      formData.append("documentType", documentType);
      formData.append("autoFile", autoFile.toString());
      if (sendToDoctor && providerNumber.trim()) {
        formData.append("orderingProvider", providerNumber.trim());
      }

      const response = await fetch("/api/convert", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (data.success) {
        setResult(data);
      } else {
        setResult({ success: false, error: data.error || "Conversion failed" });
      }
    } catch (error) {
      setResult({ success: false, error: "Network error. Please try again." });
    } finally {
      setIsConverting(false);
    }
  };

  const handleDownload = () => {
    if (!result?.hl7Content || !result.filename) return;

    const blob = new Blob([result.hl7Content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = result.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleReset = () => {
    setFile(null);
    setResult(null);
  };

  return (
    <main className="container mx-auto px-4 py-8 max-w-2xl">
      {/* SMEC AI Logo */}
      <div className="flex justify-center mb-6">
        <Image
          src="/smec_ai_logo_horizontal.png"
          alt="SMEC AI"
          width={200}
          height={48}
          className="h-12 w-auto"
          priority
        />
      </div>

      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">
          PDF to HL7 Converter
        </h1>
        <p className="text-gray-600">
          Convert patient consent PDFs to HL7 v2.4 format for Genie
        </p>
      </div>

      {/* Supported Format Notice */}
      <div className="mb-6 p-3 bg-blue-50 border border-blue-200 rounded-lg">
        <p className="text-sm text-blue-800">
          <strong>Supported formats:</strong> BJC Health Consent Forms and Specialist Referral Letters.
          Document type is auto-detected, or select manually below.
        </p>
      </div>

      {/* Upload Area */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`
          border-2 border-dashed rounded-lg p-8 text-center transition-colors
          ${isDragging
            ? "border-blue-500 bg-blue-50"
            : "border-gray-300 hover:border-gray-400"
          }
          ${file ? "bg-green-50 border-green-300" : ""}
        `}
      >
        {file ? (
          <div className="space-y-4">
            <div className="flex items-center justify-center gap-2 text-green-700">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="font-medium">{file.name}</span>
            </div>
            <p className="text-sm text-gray-500">
              {(file.size / 1024).toFixed(1)} KB
            </p>
            <button
              onClick={handleReset}
              className="text-sm text-red-600 hover:text-red-700 underline"
            >
              Remove file
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex justify-center">
              <svg className="w-12 h-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
            </div>
            <div>
              <p className="text-gray-700 font-medium">
                Drag and drop your PDF here
              </p>
              <p className="text-sm text-gray-500 mt-1">or</p>
            </div>
            <label className="inline-block">
              <span className="px-4 py-2 bg-blue-600 text-white rounded-md cursor-pointer hover:bg-blue-700 transition-colors">
                Browse Files
              </span>
              <input
                type="file"
                accept=".pdf"
                onChange={handleFileChange}
                className="hidden"
              />
            </label>
            <p className="text-xs text-gray-400">PDF files only, max 10MB</p>
          </div>
        )}
      </div>

      {/* Genie Actions */}
      {file && !result?.success && (
        <div className="mt-6 p-4 bg-gray-50 border border-gray-200 rounded-lg space-y-4">
          <h3 className="font-medium text-gray-700">Conversion Options</h3>

          {/* Document Type Selector */}
          <div className="space-y-1">
            <label htmlFor="documentType" className="block text-sm text-gray-700">
              Document Type
            </label>
            <select
              id="documentType"
              value={documentType}
              onChange={(e) => setDocumentType(e.target.value as "auto" | "consent_form" | "referral_letter")}
              className="w-full max-w-xs px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
            >
              <option value="auto">Auto-detect</option>
              <option value="consent_form">Consent Form</option>
              <option value="referral_letter">Referral Letter</option>
            </select>
          </div>

          <hr className="border-gray-200" />

          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={autoFile}
              onChange={(e) => setAutoFile(e.target.checked)}
              className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
            />
            <span className="text-gray-700">Auto-file to patient record</span>
            <span className="text-xs text-gray-500">(Final result)</span>
          </label>

          <div className="space-y-2">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={sendToDoctor}
                onChange={(e) => setSendToDoctor(e.target.checked)}
                className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
              />
              <span className="text-gray-700">Send to specific doctor</span>
            </label>

            {sendToDoctor && (
              <input
                type="text"
                placeholder="Medicare Provider Number (e.g., 1234567A)"
                value={providerNumber}
                onChange={(e) => setProviderNumber(e.target.value)}
                className="ml-7 w-full max-w-xs px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            )}
          </div>
        </div>
      )}

      {/* Convert Button */}
      {file && !result?.success && (
        <div className="mt-6 text-center">
          <button
            onClick={handleConvert}
            disabled={isConverting}
            className={`
              px-6 py-3 rounded-md font-medium text-white transition-colors
              ${isConverting
                ? "bg-gray-400 cursor-not-allowed"
                : "bg-blue-600 hover:bg-blue-700"
              }
            `}
          >
            {isConverting ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Converting...
              </span>
            ) : (
              "Convert to HL7"
            )}
          </button>
        </div>
      )}

      {/* Error Message */}
      {result && !result.success && (
        <div className="mt-6 p-4 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-red-700">{result.error}</p>
        </div>
      )}

      {/* Success Result */}
      {result?.success && (
        <div className="mt-6 space-y-4">
          <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
            <h3 className="font-medium text-green-800 mb-2">
              ✓ Conversion Successful
            </h3>
            {result.extractedData && (
              <div className="text-sm text-green-700 space-y-1">
                <p><strong>Patient:</strong> {result.extractedData.firstName} {result.extractedData.lastName}</p>
                <p><strong>DOB:</strong> {result.extractedData.dob}</p>
                <p><strong>Sex:</strong> {result.extractedData.sex}</p>
                <p><strong>Medicare:</strong> {result.extractedData.medicareNo}</p>
              </div>
            )}
          </div>

          <div className="flex gap-4 justify-center">
            <button
              onClick={handleDownload}
              className="px-6 py-3 bg-green-600 text-white rounded-md font-medium hover:bg-green-700 transition-colors"
            >
              Download HL7 File
            </button>
            <button
              onClick={handleReset}
              className="px-6 py-3 bg-gray-200 text-gray-700 rounded-md font-medium hover:bg-gray-300 transition-colors"
            >
              Convert Another
            </button>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="mt-12 text-center text-sm text-gray-500">
        <p>HL7 v2.4 format compatible with Genie Solutions</p>
        <p className="mt-1">Files are processed in memory and not stored</p>
      </footer>
    </main>
  );
}
