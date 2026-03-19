#!/usr/bin/env node
import http from "node:http";
import net from "node:net";

const listenHost = process.argv[2] || "0.0.0.0";
const listenPort = Number(process.argv[3] || 9223);
const targetHost = process.argv[4] || "127.0.0.1";
const targetPort = Number(process.argv[5] || 9222);

const server = http.createServer((req, res) => {
  const proxyReq = http.request(
    {
      host: targetHost,
      port: targetPort,
      method: req.method,
      path: req.url,
      headers: req.headers,
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
      proxyRes.pipe(res);
    },
  );

  proxyReq.on("error", (error) => {
    res.writeHead(502, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: String(error && error.message ? error.message : error) }));
  });

  req.pipe(proxyReq);
});

server.on("upgrade", (req, socket, head) => {
  const upstream = net.connect(targetPort, targetHost, () => {
    const headerLines = Object.entries(req.headers)
      .map(([key, value]) => `${key}: ${value}`)
      .join("\r\n");
    upstream.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n${headerLines}\r\n\r\n`);
    if (head?.length) upstream.write(head);
    socket.pipe(upstream);
    upstream.pipe(socket);
  });

  upstream.on("error", () => socket.destroy());
  socket.on("error", () => upstream.destroy());
});

server.listen(listenPort, listenHost, () => {
  console.log(
    JSON.stringify(
      {
        status: "listening",
        listen: `${listenHost}:${listenPort}`,
        target: `${targetHost}:${targetPort}`,
      },
      null,
      2,
    ),
  );
});
