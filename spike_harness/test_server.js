const http = require('http');

const server = http.createServer((req, res) => {
  const url = req.url;
  console.log(`[HTTP_SERVER] Request: ${req.method} ${url}`);

  if (url === '/unmanaged') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
      <!DOCTYPE html>
      <html>
        <head><title>Unmanaged Page</title></head>
        <body>
          <h1>Unmanaged Page</h1>
          <a id="linkToTarget" href="http://127.0.0.1:8080/target">Go to Target</a>
        </body>
      </html>
    `);
    return;
  }

  if (url === '/target') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
      <!DOCTYPE html>
      <html>
        <head><title>Managed Target Page</title></head>
        <body>
          <h1 id="targetHeader">SUCCESS: Managed Target Reached</h1>
          <p>Content loaded safely.</p>
        </body>
      </html>
    `);
    return;
  }

  if (url === '/redirect') {
    res.writeHead(302, { 'Location': 'http://127.0.0.1:8080/target' });
    res.end();
    return;
  }

  if (url === '/spa') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
      <!DOCTYPE html>
      <html>
        <head><title>SPA Page</title></head>
        <body>
          <h1>SPA Test Page</h1>
          <button id="btnPushState" onclick="history.pushState({}, '', '/target')">PushState to Target</button>
        </body>
      </html>
    `);
    return;
  }

  res.writeHead(404);
  res.end('Not Found');
});

server.listen(8080, '127.0.0.1', () => {
  console.log('[HTTP_SERVER] Listening on http://127.0.0.1:8080');
});
