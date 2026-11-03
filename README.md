# DeploySphere

DeploySphere is a DevOps dashboard for CI/CD pipelines, deployments, server
monitoring, alerts, logs, repositories, integrations, team access, and audit
history. The local demo uses sample data. Production seeding creates an admin
using a generated, private password instead of the published local demo login.

## Run locally

1. In `backend`, install dependencies and start FastAPI:

   ```powershell
   python -m pip install -r requirements.txt
   python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
   ```

2. In another terminal, install and start the frontend:

   ```powershell
   cd frontend
   npm install
   npm run dev
   ```

   Open <http://127.0.0.1:5173/>. VS Code also provides a **Run DeploySphere**
   task that starts both services.

## Public deployment (Vercel + Render + Neon)

The public website can be opened from phones while your computer is off. The
frontend is hosted on Vercel, the API on Render, and persistent records in
Neon PostgreSQL. GitHub stores the source code; it does not keep the API running.
Render's free web service can sleep while idle, so the first visit may take a
little longer.

### 1. Publish the source repository

The public repository is [github.com/aliraza22p/DeploySphere](https://github.com/aliraza22p/DeploySphere).
From PowerShell in this project folder, push the source:

```powershell
git add .
git commit -m "Prepare DeploySphere for deployment"
git branch -M main
git remote add origin https://github.com/aliraza22p/DeploySphere.git
git push -u origin main
```

If `origin` is already configured, skip `git remote add`. Never commit `.env`
files, database files, or credentials.

### 2. Create the persistent database

Create a free PostgreSQL project on Neon. Copy its pooled connection URL and
keep it private.

### 3. Deploy the backend to Render

Create a Render Blueprint from the GitHub repository and select the root
`render.yaml`. Provide these values when prompted:

- `DATABASE_URL`: the Neon connection URL.
- `DEMO_ADMIN_EMAIL`: your email address.
- `CORS_ORIGINS`: a temporary origin for the initial deploy; after step 4,
  replace it with your Vercel origin, without a trailing slash.

Render generates `SECRET_KEY` and `DEMO_ADMIN_PASSWORD`. The first boot seeds
sample records and one administrator. Find the generated admin password in the
Render service's environment settings and keep it private.

### 4. Deploy the frontend to Vercel

Import the same GitHub repository. Set the Vercel project's root directory to
`frontend` and add these environment variables:

- `VITE_API_BASE_URL`: the Render backend origin, e.g.
  `https://deploysphere-api.onrender.com` (no `/api/v1` suffix).
- `VITE_SHOW_DEMO_ACCESS`: `false`.

Deploy the frontend. Copy the Vercel site origin, such as
`https://deploysphere-example.vercel.app`, into Render's `CORS_ORIGINS`, then
redeploy the backend. The Vercel URL is the permanent mobile-friendly link.

### Receive real GitHub Actions run status

The GitHub repository page can send signed `workflow_run` events to DeploySphere.
Completed runs are stored as live pipeline runs; sample dashboard records remain
labelled as demo data.

1. In the backend hosting project's environment variables, set
   `GITHUB_WEBHOOK_SECRET` to a new, long random value and redeploy the API.
2. In GitHub, open the repository's **Settings → Webhooks → Add webhook**:
   - Payload URL: `https://deploysphere-api.vercel.app/api/v1/repositories/webhook/github`
   - Content type: `application/json`
   - Secret: the same value configured in the backend
   - Choose **Let me select individual events**, then select **Workflow runs**.
3. Save the webhook. The included `DeploySphere CI` workflow runs backend tests
   and builds the frontend on pushes and pull requests to `main`.
4. Open DeploySphere's **Pipelines** page after the first workflow finishes.
   The signed event registers the repository and shows the actual GitHub Actions
   result, commit, branch, and duration with a `live` source label.

Keep the webhook secret private. Never add it to source files, browser-side
environment variables, or chat messages.
