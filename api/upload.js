// api/upload.js
import { Octokit } from "@octokit/core";
import formidable from "formidable";
import { createReadStream } from "fs";

export const config = {
  api: {
    bodyParser: false, // Disable Vercel's default body parsing to handle multipart/form-data
  },
};

export default async function handler(req, res) {
  console.log("Received request:", req.method, req.headers);

  if (req.method !== "POST") {
    console.log("Method not allowed:", req.method);
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    // Verify environment variables
    if (!process.env.QA_PASSPHRASE) {
      throw new Error("QA_PASSPHRASE environment variable is not set");
    }
    if (!process.env.GH_PAT) {
      throw new Error("GH_PAT environment variable is not set");
    }

    // Parse multipart/form-data using formidable
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

    // Extract passphrase and file
    const pass = fields.passphrase && fields.passphrase[0] ? fields.passphrase[0].trim().toLowerCase() : null;
    const file = files.file && files.file[0] ? files.file[0] : null;

    console.log("Extracted fields:", { passphrase: pass, file });

    // 1. Gatekeeper
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

    // 2. File validation
    if (!file || !file.originalFilename || !file.originalFilename.endsWith(".xlsx")) {
      console.log("File validation failed:", file);
      return res.status(400).json({ error: "Expecting file=input.xlsx" });
    }

    // 3. Read file content
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
    const contentB64 = fileContent.toString("base64");
    console.log("File read successfully, length:", fileContent.length);

    // 4. Create a draft release and upload the file as an asset
    console.log("Initializing Octokit...");
    const octo = new Octokit({ auth: process.env.GH_PAT });

    // Create a draft release
    console.log("Creating draft release...");
    const releaseResponse = await octo.request("POST /repos/{owner}/{repo}/releases", {
      owner: "rsmedstad",
      repo: "gehc-cmc-testing",
      tag_name: `qa-run-${Date.now()}`, // Unique tag for the release
      name: "QA Run Draft Release",
      draft: true,
      prerelease: false,
      generate_release_notes: false,
    });
    const releaseId = releaseResponse.data.id;
    console.log("Draft release created, release_id:", releaseId);

    // Upload input.xlsx as an asset to the draft release
    console.log("Uploading input.xlsx as an asset to the draft release...");
    const assetResponse = await octo.request(
      "POST /repos/{owner}/{repo}/releases/{release_id}/assets{?name,label}",
      {
        owner: "rsmedstad",
        repo: "gehc-cmc-testing",
        release_id: releaseId,
        name: "input.xlsx",
        headers: {
          "content-type": "application/octet-stream",
        },
        data: fileContent, // Use the raw file content (Buffer)
      }
    );
    const assetId = assetResponse.data.id;
    console.log("Asset uploaded, asset_id:", assetId);

    // 5. Trigger the GitHub Actions workflow
    console.log("Triggering GitHub Actions workflow...");
    await octo.request(
      "POST /repos/{owner}/{repo}/actions/workflows/{file}/dispatches",
      {
        owner: "rsmedstad",
        repo: "gehc-cmc-testing",
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

    return res.status(200).json({ ok: true, message: "Workflow dispatched ✅" });
  } catch (error) {
    console.error("Error in Vercel Function:", error);
    return res.status(500).json({ error: `Internal server error: ${error.message}` });
  }
}