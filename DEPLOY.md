# Deploying FieldProof

FieldProof is one Node.js process plus two folders of data (the SQLite file and the photos). Anything that can run Node.js 20+ or a Docker container with a persistent disk will do. HTTPS is required: browsers only allow GPS, the camera, offline mode and push notifications on secure sites.

## Option A — a small virtual server (lowest running cost)

Suitable for the release 1 budget. Any provider's smallest Linux server (1 vCPU, 1 GB RAM) is enough.

1. Point a domain (for example `app.yourcompany.mu`) at the server's IP address.
2. Install Node.js 22 and Caddy (it obtains HTTPS certificates automatically).
3. Copy the project to `/opt/fieldproof`, then:
   ```bash
   cd /opt/fieldproof
   npm run install:all && npm run build
   cp server/.env.example server/.env   # then edit: JWT_SECRET, APP_URL, SMTP, VAPID
   ```
4. Run it as a service, `/etc/systemd/system/fieldproof.service`:
   ```ini
   [Unit]
   Description=FieldProof
   After=network.target

   [Service]
   WorkingDirectory=/opt/fieldproof/server
   ExecStart=/usr/bin/node src/index.js
   Restart=always
   User=www-data
   Environment=NODE_ENV=production

   [Install]
   WantedBy=multi-user.target
   ```
   Then `sudo systemctl enable --now fieldproof`. Make sure `www-data` can write to `server/data`.
5. Caddy, `/etc/caddy/Caddyfile`:
   ```
   app.yourcompany.mu {
     reverse_proxy localhost:3000
   }
   ```
   Then `sudo systemctl reload caddy`.

## Option B — Docker on a platform with a persistent disk

```bash
docker build -t fieldproof .
docker run -d --name fieldproof -p 3000:3000 -v fieldproof-data:/data \
  -e JWT_SECRET=... -e APP_URL=https://app.yourcompany.mu fieldproof
```

On a hosting platform (Render, Fly.io, Railway and similar), deploy the Dockerfile, attach a persistent volume at `/data`, and set the environment variables from `server/.env.example`. The data must be on a persistent volume, or it is lost on each deploy.

## After the first deploy

1. Open the site and register your company. To stop others registering, set `SIGNUP_CODE` and share it only with companies you onboard.
2. In Settings, check the time zone (`Indian/Mauritius`), currency and rules.
3. Add skills and invite supervisors and workers under People, then add services, customers and sites (pin each site on the map).
4. Workers open the link on their phone, accept the invitation, then use "Add to home screen".
5. Optional: run `npm --prefix server run vapid`, put the keys in `.env` and restart, so people can turn on push notifications in their profile.

## Email

Use any SMTP service (your domain's mailbox, or a transactional email provider). Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` and `MAIL_FROM`. Until then, emails are printed in the server log and admins can copy invitation links from the screen.

## Backups (NFR-13)

Back up daily and keep at least 7 copies:

```bash
sqlite3 /opt/fieldproof/server/data/fieldproof.db ".backup '/backups/fieldproof-$(date +%F).db'"
tar czf /backups/uploads-$(date +%F).tgz -C /opt/fieldproof/server/data uploads
find /backups -mtime +7 -delete
```

Put this in a daily cron job and copy `/backups` off the server.

## Updating

```bash
cd /opt/fieldproof && git pull   # or copy the new files
npm run install:all && npm run build
sudo systemctl restart fieldproof
```

Database changes are applied automatically at start-up from `server/src/migrations`.

## Security checklist before launch

- `NODE_ENV=production` and a long random `JWT_SECRET`.
- Served only over HTTPS, `TRUST_PROXY=true` behind the proxy.
- Backups running and tested by restoring once.
- Demo data not loaded (`npm run seed` wipes the database; never run it on the live server).
- Privacy notice text reviewed by your legal adviser (Mauritius Data Protection Act 2017, GDPR).
