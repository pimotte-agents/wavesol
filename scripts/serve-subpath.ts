// Serves a static directory under a URL prefix, to test that builds work from a subpath (like GitHub
// Pages project sites). Usage: tsx scripts/serve-subpath.ts <dir> <prefix> <port>
// Like `wavesol serve`, it also runs the local relay (the e2e tests' signaling/relay stub), plus a
// test-only endpoint, POST <prefix>__wavesol/test/drop-relay, that disconnects every relay client.
import { createServer } from "node:http";
import sirv from "sirv";
import { attachRelay, createRelay } from "../src/cli/relay.ts";

const [dir, prefix = "/wavesol/", port = "4180"] = process.argv.slice(2);
const serve = sirv(dir!, { dev: true });
const relay = createRelay(prefix, () => ({ lan: [] }));
const server = createServer((req, res) => {
  if (!req.url?.startsWith(prefix)) {
    res.statusCode = 404;
    return res.end("not under " + prefix);
  }
  if (req.method === "POST" && req.url === `${prefix}__wavesol/test/drop-relay`) {
    relay.dropAll();
    return res.end("dropped");
  }
  if (relay.handleRequest(req, res)) return;
  req.url = req.url.slice(prefix.length - 1);
  serve(req, res, () => {
    res.statusCode = 404;
    res.end();
  });
});
attachRelay(server, relay);
server.listen(Number(port), () => console.log(`serving ${dir} at http://localhost:${port}${prefix}`));
