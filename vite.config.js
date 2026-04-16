import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { existsSync, readFileSync } from 'fs'
import path from 'path'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "")
  const pistonTarget = env.VITE_PISTON_PROXY_TARGET
  const pistonBasePath = env.VITE_PISTON_PROXY_BASE_PATH || "/api/v2/piston"
  const useHttps = env.VITE_DEV_HTTPS === "true"
  const allowedHosts = [
    "travesty-catalyst-auction.ngrok-free.dev",
    ...(env.VITE_DEV_ALLOWED_HOSTS || "")
      .split(",")
      .map((host) => host.trim())
      .filter(Boolean),
  ]
  const apiProxyTarget = (env.VITE_API_PROXY_TARGET || `http://localhost:${env.VITE_BACKEND_PORT || 3000}`).trim()

  const proxy = {}

  if (apiProxyTarget) {
    proxy["/api"] = {
      target: apiProxyTarget,
      changeOrigin: true,
    }
  }

  if (pistonTarget) {
    proxy["/api/piston"] = {
      target: pistonTarget,
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/api\/piston/, pistonBasePath),
    }
  }

  const certDir = path.resolve(process.cwd(), ".cert")
  const certPath = path.join(certDir, "dev-cert.pem")
  const keyPath = path.join(certDir, "dev-key.pem")
  const https = useHttps && existsSync(certPath) && existsSync(keyPath)
    ? {
        cert: readFileSync(certPath),
        key: readFileSync(keyPath),
      }
    : undefined

  return {
    plugins: [react(), tailwindcss()],
    server: {
      host: "0.0.0.0",
      allowedHosts,
      https,
      proxy: Object.keys(proxy).length ? proxy : undefined,
    },
    preview: {
      host: "0.0.0.0",
      https,
    },
    build: {
      outDir: 'build',
    },
  }
})
