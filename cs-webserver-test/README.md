# C# Web Server Test

This is an isolated ASP.NET Core Minimal API used to verify that a C# backend
can be built in Docker and hosted as a Render Web Service.

The project targets .NET 10 LTS. Running it directly with `dotnet run` requires
the .NET 10 SDK; Docker builds use the matching SDK and runtime images.

## Endpoints

```text
GET /api/hello
GET /api/status
WebSocket /ws
```

`/api/status` is also suitable for Render's health check path.

The WebSocket endpoint accepts text messages and broadcasts each message to
every other connected client. The client that sent the message does not
receive its own message.

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

## Static WebSocket test page

`websocket-test.html` is intentionally not served by the C# server. Host it
with a static site host, or open it through a local static server. Give it the
backend URL as a query parameter:

```text
https://your-static-site.example/websocket-test.html?server=https%3A%2F%2Fyour-service.onrender.com
```

The page connects immediately, shows its connection status, and lets you send
messages. Open the page in two browser windows to verify that each message is
received by the other window but not echoed to the sender.

For local testing, use an `http://` server URL so the page connects with
`ws://`. For Render, use the HTTPS service URL so the page connects with
`wss://`.

## Render settings

Create a Render **Web Service** connected to this repository with:

- Root Directory: `cs-webserver-test`
- Language: `Docker`
- Dockerfile Path: `Dockerfile`
- Health Check Path: `/api/status`
- Environment variable: `PORT=10000`

The Dockerfile supplies the container entrypoint, so no custom start command is
needed.

The WebSocket implementation currently keeps connected clients in memory. This
is sufficient for a single Render instance and this test; a multi-instance
deployment would need shared pub/sub storage for broadcasts across instances.
