const apiUrl = process.env.NEXT_PUBLIC_API_URL || "/api/v1";
const normalizedApiUrl = apiUrl.replace(/\/api\/v1\/?$/, "");
const isProduction = process.env.NODE_ENV === "production";

if (isProduction && apiUrl.startsWith("//")) {
  throw new Error("NEXT_PUBLIC_API_URL must not be a protocol-relative URL in production.");
}

if (!apiUrl.startsWith("/")) {
  const parsedApiUrl = new URL(apiUrl);
  if (isProduction && parsedApiUrl.protocol !== "https:") {
    throw new Error("NEXT_PUBLIC_API_URL must use HTTPS in production.");
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  async rewrites() {
    if (apiUrl.startsWith("/")) {
      return [];
    }
    return [{
      source: "/api/v1/:path*",
      destination: `${normalizedApiUrl}/api/v1/:path*`,
    }];
  },
};

module.exports = nextConfig;
