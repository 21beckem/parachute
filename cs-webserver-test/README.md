# C# Web Server Test

This is an isolated ASP.NET Core Minimal API used to verify that a C# backend
can be built in Docker and hosted as a Render Web Service.

The project targets .NET 10 LTS. Running it directly with `dotnet run` requires
the .NET 10 SDK; Docker builds use the matching SDK and runtime images.

## Endpoints

```text
GET /api/hello
GET /api/status
```

`/api/status` is also suitable for Render's health check path.

## Run locally with .NET

From this directory:

```powershell
$env:PORT = "10000"
dotnet run
```

In another terminal:

```powershell
Invoke-RestMethod http://localhost:10000/api/hello
Invoke-RestMethod http://localhost:10000/api/status
```

## Build and run with Docker

From the repository root:

```powershell
docker build -t parachute-cs-test ./cs-webserver-test
docker run --rm -e PORT=10000 -p 8080:10000 parachute-cs-test
```

Then call:

```powershell
Invoke-RestMethod http://localhost:8080/api/hello
Invoke-RestMethod http://localhost:8080/api/status
```

## Render settings

Create a Render **Web Service** connected to this repository with:

- Root Directory: `cs-webserver-test`
- Language: `Docker`
- Dockerfile Path: `Dockerfile`
- Health Check Path: `/api/status`
- Environment variable: `PORT=10000`

The Dockerfile supplies the container entrypoint, so no custom start command is
needed.

WebSocket support is intentionally not enabled yet. The server keeps the JSON
API grouped under `/api`, leaving room for a future dedicated WebSocket route
and middleware without changing these test endpoints.
