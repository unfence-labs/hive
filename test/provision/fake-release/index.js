// Minimal stand-in for the Hive backend, used only by the provision test
// harness so health_check exercises a real systemd-managed HTTP service.
const http = require("node:http");
const fs = require("node:fs");
const version = fs.readFileSync("health-version", "utf8").trim();
const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 3000);

http
  .createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok", version }));
      return;
    }
    res.writeHead(404);
    res.end();
  })
  .listen(port, host, () => console.log(`fake hive listening on ${host}:${port}`));
