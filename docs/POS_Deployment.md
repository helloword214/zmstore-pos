# POS Docker — Update & Redeploy (Commands Only)

Use this when you have new code to deploy.

---

## A) DEV MACHINE — Build & Push

### If schema changed

```bash
npx prisma migrate dev -n "describe_change"
```

### Login to Docker Hub (recommended: token)

```bash
echo 'YOUR_TOKEN' | docker login -u YOURUSER --password-stdin
```

### Ensure multi-arch builder (one-time)

```bash
docker buildx create --name posbuilder --driver docker-container --use || true
docker buildx inspect --bootstrap
```

### Build & push multi-arch image

```bash
docker buildx build --platform linux/amd64,linux/arm64   -t YOURUSER/pos-app:$(date +%Y%m%d-%H%M)   -t YOURUSER/pos-app:latest   --push .
```

> Replace **YOURUSER** with your Docker Hub username (lowercase).

---

## B) SERVER — Pull, Migrate, Restart

### Login (if needed)

```bash
echo 'YOUR_TOKEN' | sudo docker login -u YOURUSER --password-stdin
```

### Pull latest image

```bash
sudo docker pull YOURUSER/pos-app:latest
```

### Run migrations (safe even if none)

```bash
sudo docker run --rm --network zmstore-pos_default --env-file /home/USER/apps/zmstore/.env YOURUSER/pos-app:latest npx prisma migrate deploy
```

### Restart app

```bash
sudo docker stop pos-app || true && sudo docker rm pos-app || true && sudo docker run -d --name pos-app --network zmstore-pos_default -p 8000:3000   --env-file /home/USER/apps/zmstore/.env YOURUSER/pos-app:latest
```

---

## Health Checks (server)

```bash
sudo docker ps --format "table {{.Names}}	{{.Status}}	{{.Ports}}"
curl -I http://localhost:8000
sudo docker logs --tail 100 pos-app
```

---

## Rollback to a known tag

```bash
sudo docker pull YOURUSER/pos-app:YYYYMMDD-HHMM
sudo docker stop pos-app && sudo docker rm pos-app
sudo docker run -d --name pos-app --network zmstore-pos_default -p 8000:3000   --env-file /home/USER/apps/zmstore/.env YOURUSER/pos-app:YYYYMMDD-HHMM
```

---

## Auto-restart after reboot (one-time)

```bash
sudo systemctl enable docker
sudo docker update --restart unless-stopped pos-app
sudo docker update --restart unless-stopped zmstore-pos-db-1
```

---

## Notes

- `.env` lives on the **server** (don’t commit to Git). Adjust the path `/home/USER/apps/zmstore/.env` if yours is different.
- DB host in `.env` must be **zmstore-pos-db-1** (not `localhost`) when running in Docker network.
- Use date tags for safe rollbacks (e.g., `20250819-1130`).
- If your Docker network name differs, replace `zmstore-pos_default` accordingly.
