#!/usr/bin/env node
/**
 * One-time Google OAuth helper.
 *
 * Exchanges a browser consent for a long-lived refresh token, which you paste
 * into `.env` as GOOGLE_REFRESH_TOKEN. After this the app never needs an
 * interactive flow again.
 *
 * Prerequisites — in https://console.cloud.google.com:
 *   1. Enable the Google Drive API for your project.
 *   2. Create an OAuth client ID of type "Desktop app".
 *   3. Put its id and secret in .env as GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET.
 *   4. While the consent screen is in "Testing", add your own Google account
 *      under "Test users" — otherwise consent is refused.
 *
 * Run:  node --env-file=.env scripts/google-auth.mjs
 */
import http from "node:http";
import { google } from "googleapis";

// Only files this app creates. It cannot read the rest of your Drive.
const SCOPES = ["https://www.googleapis.com/auth/drive.file"];
const PORT = 53682;
const REDIRECT_URI = `http://127.0.0.1:${PORT}`;

const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = process.env;

if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
  console.error(
    "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set.\n" +
      "Add them to .env, then run: node --env-file=.env scripts/google-auth.mjs",
  );
  process.exit(1);
}

const oauth2 = new google.auth.OAuth2(
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  REDIRECT_URI,
);

const authUrl = oauth2.generateAuthUrl({
  access_type: "offline",
  scope: SCOPES,
  // Google only returns a refresh token on first consent; forcing the prompt
  // makes re-runs work instead of silently returning an access token alone.
  prompt: "consent",
});

console.log("\nOpen this URL in your browser and approve access:\n");
console.log(authUrl);
console.log(`\nWaiting for the redirect on ${REDIRECT_URI} ...\n`);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT_URI);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error) {
    res.writeHead(400, { "Content-Type": "text/plain" });
    res.end(`Authorization failed: ${error}`);
    console.error(`\nAuthorization failed: ${error}`);
    server.close();
    process.exit(1);
  }

  if (!code) {
    res.writeHead(400, { "Content-Type": "text/plain" });
    res.end("Missing authorization code.");
    return;
  }

  try {
    const { tokens } = await oauth2.getToken(code);

    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(
      "<html><body style=\"font-family:system-ui;padding:3rem\">" +
        "<h2>Authorized</h2><p>You can close this tab and return to the terminal.</p>" +
        "</body></html>",
    );

    if (!tokens.refresh_token) {
      console.error(
        "\nNo refresh token returned. Revoke the app at " +
          "https://myaccount.google.com/permissions and run this again.",
      );
      server.close();
      process.exit(1);
    }

    console.log("Add this line to your .env:\n");
    console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}\n`);
  } catch (err) {
    console.error("\nToken exchange failed:", err.message);
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("Token exchange failed.");
    process.exitCode = 1;
  } finally {
    server.close();
    setTimeout(() => process.exit(process.exitCode ?? 0), 100);
  }
});

server.listen(PORT, "127.0.0.1");
