// Serves a static directory under a URL prefix, to test that builds work from a subpath (like GitHub
// Pages project sites). Usage: tsx scripts/serve-subpath.ts <dir> <prefix> <port>
import { createServer } from "node:http";
import sirv from "sirv";

const [dir, prefix = "/wavesol/", port = "4180"] = process.argv.slice(2);
const serve = sirv(dir!, { dev: true });
createServer((req, res) => {
  if (!req.url?.startsWith(prefix)) {
    res.statusCode = 404;
    return res.end("not under " + prefix);
  }
  req.url = req.url.slice(prefix.length - 1);
  serve(req, res, () => {
    res.statusCode = 404;
    res.end();
  });
}).listen(Number(port), () => console.log(`serving ${dir} at http://localhost:${port}${prefix}`));
