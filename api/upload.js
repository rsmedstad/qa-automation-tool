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
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }

  try {
    // Parse multipart/form-data
    const form = formidable({ multiples: false });
    const { fields, files } = await new Promise((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) reject(err);
        resolve({ fields, files });
      });
    });

    const pass = fields.passphrase?.[0];
    const file = files.file?.[0];

    // 1. Gatekeeper
    if (!pass || pass !== process.env.QA_PASSPHRASE) {
      return res.status(401).json({ error: "Bad pass-phrase" });
    }
    if (!file || !file.originalFilename.endsWith(".xlsx")) {
      return res.status(400).json({ error: "Expecting file=input.xlsx" });
    }

    // 2. Upload blob to GitHub
    const octo = new Octokit({ auth: process.env.GH_PAT });
    const fileStream = createReadStream(file.filepath);
    const fileBuffer = await new Promise((resolve, reject) => {
      const chunks = [];
      fileStream.on("data", (chunk) => chunks.push(chunk));
      fileStream.on("end", () => resolve(Buffer.concat(chunks)));
      fileStream.on("error", reject);
    });
    const contentB64 = fileBuffer.toString("base64");

    await octo.request("PUT /repos/{owner}/{repo}/contents/{path}", {
      owner: "rsmedstad",
      repo: "gehc-cmc-testing",
      path: "uploads/input.xlsx",
      message: "ci: add input.xlsx from Vercel",
      content: contentB64,
      committer: { name: "QA Worker", email: "noreply@example.com" },
      author: { name: "QA Worker", email: "noreply@example.com" },
    });

    // 3. Trigger the GitHub Actions workflow
    await octo.request(
      "POST /repos/{owner}/{repo}/actions/workflows/{file}/dispatches",
      {
        owner: "rsmedstad",
        repo: "gehc-cmc-testing",
        file: "run-qa.yml",
        ref: "main",
        inputs: {
          passphrase: process.env.QA_PASSPHRASE,
          input_zip_b64: "",
        },
      }
    );

    return res.status(200).json({ ok: true, message: "Workflow dispatched ✅" });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Internal server error" });
  }
}