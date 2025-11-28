const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = 3000;

// MIME types
const mimeTypes = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

// Read SSL certificates
const options = {
  key: fs.readFileSync(path.join(__dirname, 'key.pem')),
  cert: fs.readFileSync(path.join(__dirname, 'cert.pem'))
};

// Cache busting timestamp
const cacheVersion = Date.now();

// Create HTTPS server
const server = https.createServer(options, (req, res) => {
  console.log(`${req.method} ${req.url}`);

  // Parse URL (remove query params for file lookup)
  const parsedUrl = url.parse(req.url);
  let pathname = `.${parsedUrl.pathname}`;

  // Default to index.html
  if (pathname === './') {
    pathname = './index.html';
  }

  // Get file extension
  const ext = path.parse(pathname).ext;

  fs.readFile(pathname, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.statusCode = 404;
        res.end('File not found');
      } else {
        res.statusCode = 500;
        res.end('Internal server error');
      }
    } else {
      // Set content type
      res.setHeader('Content-type', mimeTypes[ext] || 'text/plain');

      // For HTML files, inject cache busting into script and link tags
      if (ext === '.html') {
        let html = data.toString();

        // Add cache busting to script tags
        html = html.replace(
          /<script\s+src="([^"]+\.js)"/g,
          `<script src="$1?v=${cacheVersion}"`
        );

        // Add cache busting to CSS link tags
        html = html.replace(
          /<link\s+rel="stylesheet"\s+href="([^"]+\.css)"/g,
          `<link rel="stylesheet" href="$1?v=${cacheVersion}"`
        );

        res.end(html);
      } else {
        res.end(data);
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`HTTPS Server running at https://localhost:${PORT}/`);
  console.log('Note: You will need to accept the self-signed certificate warning in your browser');
});
