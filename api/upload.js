/*───────────────────────────────────────────────────────────────────────────────
  api/upload.js
  ----------
  • Vercel Function to handle file uploads (e.g., input.xlsx) for QA testing
  • Validates a passphrase, uploads the file to a GitHub draft release, and triggers
    a GitHub Actions workflow (run-qa.yml)
  • Uses ES Modules for compatibility with Vercel
  • Does not write files locally, avoiding issues with uploads/ directory
───────────────────────────────────────────────────────────────────────────────*/

import { Octokit } from "@octokit/core";
import formidable from "formidable";
import { createReadStream } from "fs";

// Configure Vercel to disable default body parsing for multipart/form-data
export const config = {
  api: {
    bodyParser: false,
  },
};

/**
 * Vercel Function handler for POST requests to upload files and trigger QA workflow.
 * @param {Object} req - The HTTP request object.
 * @param {Object} res - The HTTP response object.
 */
export default async function handler(req, res) {
  console.log("Received request:", req.method, req.headers);

  // Step 1: Validate request method (only POST allowed)
  if (req.method !== "POST") {
    console.log("Method not allowed:", req.method);
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    // Step 2: Verify environment variables for authentication
    if (!process.env.QA_PASSPHRASE) {
      throw new Error("QA_PASSPHRASE environment variable is not set");
    }
    if (!process.env.GH_PAT) {
      throw new Error("GH_PAT environment variable is not set");
    }

    // Step 3: Parse multipart/form-data using formidable
    console.log("Parsing form data...");
    const form = formidable({ multiples: false });
    const { fields, files } = await new Promise((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) {
          console.error("Form parsing error:", err);
          reject(new Error(`Form parsing failed: ${err.message}`));
        }
        console.log("Form parsed successfully:", { fields, files });
        resolve({ fields, files });
      });
    });

    // Step 4: Extract passphrase and file from form data
    const pass = fields.passphrase && fields.passphrase[0] ? fields.passphrase[0].trim().toLowerCase() : null;
    const file = files.file && files.file[0] ? files.file[0] : null;

    console.log("Extracted fields:", { passphrase: pass, file });

    // Step 5: Validate passphrase
    if (!pass) {
      console.log("Passphrase missing");
      return res.status(401).json({ error: "Passphrase is required" });
    }
    const expectedPassphrase = process.env.QA_PASSPHRASE.trim().toLowerCase();
    console.log("Comparing passphrases:", {
      sent: pass,
      sentLength: pass.length,
      expected: expectedPassphrase,
      expectedLength: expectedPassphrase.length,
    });
    if (pass !== expectedPassphrase) {
      console.log("Passphrase mismatch:", pass, expectedPassphrase);
      return res.status(401).json({ error: "Bad pass-phrase" });
    }

    // Step 6: Validate file presence and type
    if (!file || !file.originalFilename || !file.originalFilename.endsWith(".xlsx")) {
      console.log("File validation failed:", file);
      return res.status(400).json({ error: "Expecting file=input.xlsx" });
    }

    // Step 7: Read file content into memory (no local save to uploads/)
    console.log("Reading file:", file.filepath);
    const fileContent = await new Promise((resolve, reject) => {
      const chunks = [];
      const stream = createReadStream(file.filepath);
      stream.on("data", (chunk) => chunks.push(chunk));
      stream.on("end", () => resolve(Buffer.concat(chunks)));
      stream.on("error", (err) => {
        console.error("File reading error:", err);
        reject(err);
      });
    });
    console.log("File read successfully, length:", fileContent.length);

    // Step 8: Initialize Octokit for GitHub API interactions
    console.log("Initializing Octokit...");
    const octokit = new Octokit({ auth: process.env.GH_PAT });

    // Step 9: Create a draft release on GitHub
    console.log("Creating draft release...");
    const releaseResponse = await octokit.request("POST /repos/{owner}/{repo}/releases", {
      owner: "rsmedstad",
      repo: "qa-automation-tool",
      tag_name: `qa-run-${Date.now()}`, // Unique tag for the release
      name: "QA Run Draft Release",
      draft: true,
      prerelease: false,
      generate_release_notes: false,
    });
    const releaseId = releaseResponse.data.id;
    const uploadUrl = releaseResponse.data.upload_url;
    console.log("Draft release created, release_id:", releaseId, "upload_url:", uploadUrl);

    // Step 10: Upload input.xlsx as an asset to the draft release
    console.log("Uploading input.xlsx as an asset to the draft release...");
    const assetUrl = uploadUrl.replace("{?name,label}", "?name=input.xlsx");
    const assetResponse = await octokit.request(`POST ${assetUrl}`, {
      headers: {
        "content-type": "application/octet-stream",
        "content-length": fileContent.length,
      },
      data: fileContent,
    }).catch(error => {
      console.error("Asset upload failed:", error);
      throw new Error(`Failed to upload asset: ${error.message}`);
    });
    const assetId = assetResponse.data.id;
    console.log("Asset uploaded, asset_id:", assetId);

    // Step 11: Trigger the GitHub Actions workflow (run-qa.yml)
    console.log("Triggering GitHub Actions workflow...");
    await octokit.request(
      "POST /repos/{owner}/{repo}/actions/workflows/{file}/dispatches",
      {
        owner: "rsmedstad",
        repo: "qa-automation-tool",
        file: "run-qa.yml",
        ref: "main",
        inputs: {
          passphrase: process.env.QA_PASSPHRASE,
          asset_id: assetId.toString(),
          release_id: releaseId.toString(),
        },
      }
    );
    console.log("Workflow triggered successfully");

    // Step 12: Return success response
    return res.status(200).json({ ok: true, message: "Workflow dispatched ✅" });
  } catch (error) {
    console.error("Error in Vercel Function:", error);
    return res.status(500).json({ error: `Internal server error: ${error.message}` });
  }
}
