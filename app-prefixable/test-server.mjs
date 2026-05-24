import http from "http";
import { readFileSync, existsSync } from "fs";
import { join, extname } from "path";

const PORT = 3002;
const API_URL = "http://192.168.1.173:4096";
const DIST_DIR = "/home/sgallat/pk-opencode-webui/app-prefixable/dist";
const baseDir = DIST_DIR;

const MIME = {
  ".html": "text/html",
  ".js": "application/javascript", 
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
};

function getMime(p) { return MIME[extname(p).toLowerCase()] || "application/octet-stream"; }

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  
  // API proxy
  if (url.pathname.startsWith("/api") || url.pathname === "/event") {
    try {
      const target = `${API_URL}${url.pathname}${url.search}`;
      console.log(`Proxy: ${req.method} ${url.pathname} → ${target}`);
      const r = await fetch(target, { method: req.method, headers: { ...req.headers, host: undefined } });
      const body = await r.text();
      res.writeHead(r.status, { "Content-Type": r.headers.get("Content-Type") || "application/json" });
      res.end(body);
    } catch (e) {
      console.error("Proxy error:", e.message);
      res.writeHead(502);
      res.end("Bad gateway");
    }
    return;
  }

  // Static files  
  let fp = url.pathname === "/" ? "/index.html" : url.pathname;
  fp = join(DIST_DIR, fp);

  if (!existsSync(fp)) { res.writeHead(404); res.end("Not found"); return; }

  let content = readFileSync(fp);
  
  // Inject branding
  if (fp.endsWith("index.html")) {
    content = content.toString().replace("__BRANDING_CONFIG__", JSON.stringify({name:"prokube.ai",url:"https://prokube.ai",icon:""}));
  }

  res.writeHead(200, { "Content-Type": getMime(fp) });
  res.end(content);
});

server.listen(PORT, () => {
  console.log(`Test server: http://localhost:${PORT}`);
  console.log(`       API: ${API_URL}`);
});