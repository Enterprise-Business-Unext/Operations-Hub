# Production Deployment: EC2, GHCR, RDS

This guide deploys the Operations Hub to one EC2 instance. GitHub Actions tests the code, publishes backend and frontend images to GHCR, and deploys the selected commit to EC2. EC2 runs Redis, the application containers, and Nginx. PostgreSQL runs only on RDS.

The production files are [docker-compose.production.yml](../docker-compose.production.yml), [production.conf.template](../nginx/production.conf.template), and [deploy-production.yml](../.github/workflows/deploy-production.yml).

## 1. AWS prerequisites

### EC2

- Use a supported Linux AMI and install Docker Engine with the Docker Compose v2 plugin on the EC2 host. Docker in local WSL does not install Docker on EC2.
- Allocate and associate an Elastic IP with the instance.
- Create the deployment directory: `/opt/operations-hub/nginx`.
- Ensure the SSH user used by Actions can write to `/opt/operations-hub` and run Docker. Add that user to the Docker group or configure a restricted deployment mechanism; Docker group membership grants root-equivalent access.

### Security groups and network

- EC2 inbound: TCP 80 and 443 from clients. Permit TCP 22 only from a trusted source. GitHub-hosted runner IP ranges change; use a self-hosted runner or AWS Systems Manager for tighter, stable deployment access.
- RDS inbound: TCP 5432 from the EC2 security group only. Do not make RDS publicly accessible.
- EC2 must be able to reach the RDS endpoint on 5432 and Microsoft identity, Microsoft Graph, and GHCR over HTTPS (443).
- Create the application database and database user in RDS before deployment. Use the RDS endpoint as the host, without a protocol prefix.

### DNS and TLS

1. Point an A record for the app domain to the EC2 Elastic IP.
2. Open inbound port 80 and ensure DNS has propagated.
3. Before the first Compose deployment, issue a certificate on EC2 using Certbot standalone while nothing is listening on port 80. The resulting files must exist at `/etc/letsencrypt/live/<DOMAIN_NAME>/fullchain.pem` and `privkey.pem`.
4. Configure Certbot renewal hooks to stop the Nginx container for standalone validation, start it after renewal, and reload Nginx after a renewed certificate is installed. Without hooks, standalone renewal cannot bind port 80 while Nginx is running.

Nginx redirects HTTP to HTTPS. The HTTPS certificate must exist before the production Nginx container can pass its health check.

## 2. Microsoft Graph mail

Create an Entra ID application registration for the backend:

1. Record the Directory (tenant) ID and Application (client) ID.
2. Create a client secret and record its value securely. The value is shown only when created.
3. Add Microsoft Graph **Application** permission `Mail.Send`, then grant tenant admin consent.
4. Set `GRAPH_SENDER_EMAIL` to an Exchange Online mailbox the app is allowed to send as. Restrict the app to the required mailbox using your organization's Exchange application access policy/RBAC controls where available.

The backend obtains an app-only OAuth token and calls Graph `sendMail`. SMTP is not used.

## 3. Prepare the EC2 environment file

Create `/opt/operations-hub/.env` on EC2. Do not commit it or copy it through the GitHub workflow. Set owner-only permissions (`chmod 600`). Replace every placeholder with a real value:

```dotenv
GHCR_IMAGE_PREFIX=ghcr.io/<lowercase-owner>/<repository>
DOMAIN_NAME=app.example.com

ENVIRONMENT=production
DEBUG=false
SECRET_KEY=<random-value-at-least-32-characters>
BACKEND_CORS_ORIGINS=[]
FRONTEND_URL=https://app.example.com

POSTGRES_SERVER=<rds-endpoint>
POSTGRES_PORT=5432
POSTGRES_USER=<rds-username>
POSTGRES_PASSWORD=<rds-password-at-least-16-characters>
POSTGRES_DB=<application-database>

REDIS_PASSWORD=<random-value-at-least-16-characters>
REDIS_DB=0

GRAPH_TENANT_ID=<entra-tenant-id>
GRAPH_CLIENT_ID=<entra-application-client-id>
GRAPH_CLIENT_SECRET=<entra-client-secret-value>
GRAPH_SENDER_EMAIL=<authorized-sender-mailbox>
EMAIL_FROM_NAME=Enterprise Ops Platform
```

Generate random application/Redis secrets rather than reusing a password. The Compose file sets `PGSSLMODE=require`, and supplies `REDIS_HOST=redis`; don't set those to public or host addresses. `IMAGE_TAG` is supplied by the workflow for each deployment, not stored in `.env`.

## 4. Configure GHCR access on EC2

The workflow publishes two private images:

- `ghcr.io/<owner>/<repository>-backend:sha-<commit-sha>`
- `ghcr.io/<owner>/<repository>-frontend:sha-<commit-sha>`

The EC2 host must authenticate before pulling private packages. Create a GitHub token with only `read:packages` access for the package owner, then log in as the same Linux user that Actions uses for deployment:

```bash
printf '%s' "$GHCR_READ_TOKEN" | docker login ghcr.io --username <github-user> --password-stdin
```

Do not put the token in the EC2 `.env`, Compose file, or repository. Store it in a root/deployment-user credential store and rotate it according to your policy. If packages are public, a GHCR login is not required.

## 5. Configure GitHub Actions

In GitHub, open **Settings > Environments**, create an environment named exactly `production`, then add these environment secrets:

| Secret | Value |
| --- | --- |
| `EC2_HOST` | EC2 Elastic IP or DNS name used by SSH |
| `EC2_USER` | Linux SSH username, such as `ubuntu` or `ec2-user` |
| `EC2_SSH_PRIVATE_KEY` | Private key for that EC2 user |
| `EC2_KNOWN_HOSTS` | Verified known-hosts line for the same hostname/IP used in `EC2_HOST` |

Add this environment variable:

| Variable | Value |
| --- | --- |
| `APP_URL` | Public health-check base URL, for example `https://app.example.com` |

Obtain the host key with `ssh-keyscan -H -t ed25519 <EC2_HOST>`, then verify its fingerprint against the EC2 host before saving it. Do not trust an unverified scan result. The private key must match the public key installed for `EC2_USER`.

The workflow uses the built-in `GITHUB_TOKEN` with package-write permission to publish images; no GHCR publishing PAT is needed in GitHub secrets. Configure the EC2 security group/network to allow the selected deployment runner to reach SSH. GitHub-hosted runner source IPs are not static; prefer a self-hosted runner or SSM for a hardened setup.

## 6. What the workflow does

`.github/workflows/deploy-production.yml` runs on pushes to `main` and manual dispatch:

1. **Test:** checks out the commit, installs Python and Node dependencies, runs backend pytest and frontend Vitest.
2. **Build and publish:** after tests pass, builds backend and frontend containers, then pushes both to GHCR tagged `sha-<full-commit-sha>`. The frontend build uses the same-origin `/api/v1` API path.
3. **Deploy:** waits for the `production` environment, configures SSH using the supplied pinned host key and private key, copies the production Compose and Nginx template to EC2, pulls that commit's images, recreates services, and prints their status.
4. **Health check:** retries `https://<APP_URL>/health` and fails the workflow if it does not return a successful response.

The workflow does not create AWS resources, install Docker on EC2, create the RDS database, create the TLS certificate, create the EC2 `.env`, or configure GHCR pull credentials on EC2. Those are one-time operations described above. A push to `main` triggers deployment only after both test and image-build jobs succeed.

## 7. First deployment and operations

Before merging to `main`, verify the EC2 `.env`, RDS connectivity/security group, GHCR login, certificate paths, DNS, and GitHub environment values. Then push or merge to `main` and watch **Actions > Build and deploy production**.

Useful commands on EC2:

```bash
cd /opt/operations-hub
IMAGE_TAG=sha-<commit-sha> docker compose -f docker-compose.production.yml ps
IMAGE_TAG=sha-<commit-sha> docker compose -f docker-compose.production.yml logs --tail=100 backend
IMAGE_TAG=sha-<commit-sha> docker compose -f docker-compose.production.yml logs --tail=100 nginx
```

Keep a record of successful image SHA tags. To roll back, set `IMAGE_TAG` to a prior successful SHA and run `docker compose -f docker-compose.production.yml pull` followed by `docker compose -f docker-compose.production.yml up -d`. The RDS database is not part of the container stack and is not removed when application containers are recreated.
