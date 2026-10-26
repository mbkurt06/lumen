import https from "node:https";
import http from "node:http";
import fs from "node:fs";

const cert=process.env.APP_HTTPS_CERT;
const key=process.env.APP_HTTPS_KEY;
const port=Number(process.env.APP_HTTPS_PORT || 3443);
const upstream=Number(process.env.APP_UPSTREAM_PORT || 3100);
if(!cert || !key) throw new Error("Missing APP_HTTPS_CERT or APP_HTTPS_KEY");

https.createServer({
  cert:fs.readFileSync(cert),
  key:fs.readFileSync(key)
},(req,res)=>{
  const proxy=http.request({
    hostname:"127.0.0.1",port:upstream,method:req.method,
    path:req.url,headers:{...req.headers,host:`127.0.0.1:${upstream}`}
  },upstreamRes=>{
    res.writeHead(upstreamRes.statusCode || 502,upstreamRes.headers);
    upstreamRes.pipe(res);
  });
  proxy.on("error",error=>{
    console.error("Upstream error:",error.message);
    if(!res.headersSent) res.writeHead(502,{"content-type":"text/plain; charset=utf-8"});
    res.end("Upstream application is unavailable.");
  });
  req.pipe(proxy);
}).listen(port,"0.0.0.0",()=>console.log(`Local HTTPS ready on port ${port}`));
