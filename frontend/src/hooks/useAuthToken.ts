/**
 * Read the runtime auth token outside of React (for useApi, ws-url,
 * ws-transport, browser-stream, image-url). The install flow issues this token
 * at runtime instead of the old build-time `VITE_HIVE_AUTH_TOKEN`.
 *
 * The env var is kept only as a one-time seed fallback so existing dev setups
 * that still export `VITE_HIVE_AUTH_TOKEN` keep working until a token is stored.
 */
export { getAuthToken } from "@/hooks/useConnection";
