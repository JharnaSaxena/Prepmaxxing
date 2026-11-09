/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["pg"],
  experimental: { cpus: 2, webpackBuildWorker: false },
};

module.exports = nextConfig;
