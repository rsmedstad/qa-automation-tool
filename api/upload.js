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

    // 4. Upload blob to GitHub
    console.log("Initializing Octokit...");
    const octo = new Octokit({ auth: process.env.GH_PAT });

    // Check if the file already exists to get its SHA
    let sha = null;
    try {
      console.log("Checking if file exists in GitHub at path: uploads/input.xlsx");
      const response = await octo.request("GET /repos/{owner}/{repo}/contents/{path}", {
        owner: "rsmedstad",
        repo: "gehc-cmc-testing",
        path: "uploads/input.xlsx",
        ref: "main",
      });
      if (response.data && response.data.sha) {
        sha = response.data.sha;
        console.log("File exists, SHA:", sha);
      } else {
        console.log("File exists but SHA not found in response:", response.data);
      }
    } catch (error) {
      console.log("GET request failed with status:", error.status, "message:", error.message);
      if (error.status === 404) {
        console.log("File does not exist, will create new file");
      } else {
        console.error("Error checking file existence:", error);
        throw new Error(`Failed to check file existence: ${error.message}`);
      }
    }

    // Upload the file (create or update)
    console.log("Uploading file to GitHub...");
    const uploadParams = {
      owner: "rsmedstad",
      repo: "gehc-cmc-testing",
      path: "uploads/input.xlsx",
      message: "ci: add input.xlsx from Vercel",
      content: contentB64,
      committer: { name: "QA Worker", email: "noreply@example.com" },
      author: { name: "QA Worker", email: "noreply@example.com" },
    };
    if (sha) {
      console.log("Including SHA in upload params:", sha);
      uploadParams.sha = sha; // Include SHA if the file exists (update)
    } else {
      console.log("No SHA, creating new file");
    }
    await octo.request("PUT /repos/{owner}/{repo}/contents/{path}", uploadParams);
    console.log("File uploaded to GitHub");

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