// Vercel serverless function entrypoint
process.env.VERCEL = "1";
import app from "../server/index.js";

export default app;
