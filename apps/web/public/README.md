# RaptorQR Static Web Build

This directory is a self-contained static build of the RaptorQR web app. It
does not require a Node.js server. Serve the directory with any static HTTP
server; do not open `index.html` directly from the filesystem.

## Python

From this directory:

```bash
python -m http.server 8080
```

From the repository root:

```bash
python -m http.server 8080 --directory apps/web/dist
```

Open `http://localhost:8080` on the same computer.

## miniserve

Put [svenstaro/miniserve](https://github.com/svenstaro/miniserve) in this directory, then
serve the build from the repository root (or just double-click the `miniserve` binary in this directory):

```bash
miniserve --spa --index index.html -i 0.0.0.0 -p 8080 apps/web/dist
```

## Camera Access Requires HTTPS

Browsers expose camera APIs only in a secure context. `http://localhost` is
normally allowed on the same device, but a phone opening
`http://<computer-lan-ip>:8080` is not. The receiving device must use an HTTPS
URL with a certificate it trusts.

With a trusted certificate and private key, miniserve can serve HTTPS:

```bash
miniserve --spa --index index.html -i 0.0.0.0 -p 8443 \
  --tls-cert cert.pem --tls-key key.pem apps/web/dist
```

Then open `https://<computer-hostname-or-ip>:8443` on the scanning device. The
certificate must cover that hostname or IP and its issuing CA must be trusted
by the device. A trusted HTTPS static host or HTTPS tunnel is often easier than
configuring a LAN certificate.
