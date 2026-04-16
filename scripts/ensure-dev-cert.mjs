import { execFileSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const certDir = path.join(projectRoot, ".cert");
const certPath = path.join(certDir, "dev-cert.pem");
const keyPath = path.join(certDir, "dev-key.pem");

if (process.env.VITE_DEV_HTTPS !== "true") {
  process.exit(0);
}

function getPrivateIpv4Addresses() {
  const addresses = new Set();

  for (const interfaces of Object.values(os.networkInterfaces())) {
    for (const entry of interfaces || []) {
      if (!entry || entry.family !== "IPv4" || entry.internal) continue;
      addresses.add(entry.address);
    }
  }

  return Array.from(addresses);
}

function buildSanList(addresses) {
  const sanValues = [
    "DNS:localhost",
    "DNS:*.localhost",
    "IP:127.0.0.1",
    "IP:::1",
    ...addresses.map((address) => `IP:${address}`),
  ];

  return Array.from(new Set(sanValues)).join(",");
}

function ensureCertificate() {
  if (existsSync(certPath) && existsSync(keyPath)) {
    return;
  }

  mkdirSync(certDir, { recursive: true });

  const san = buildSanList(getPrivateIpv4Addresses());
  const commonName = "localhost";

  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-sha256",
      "-days",
      "3650",
      "-keyout",
      keyPath,
      "-out",
      certPath,
      "-subj",
      `/CN=${commonName}`,
      "-addext",
      `subjectAltName=${san}`,
    ],
    { stdio: "inherit" }
  );

  const certPreview = readFileSync(certPath, "utf8").split("\n")[0];
  writeFileSync(path.join(certDir, ".generated"), `${new Date().toISOString()}\n${certPreview}\n`);
}

ensureCertificate();
