using Microsoft.AspNetCore.Builder;

var port = GetPort();

var builder = WebApplication.CreateBuilder(args);

// Render provides PORT at runtime. Binding to 0.0.0.0 makes the container
// reachable from outside itself; localhost-only binding would fail on Render.
builder.WebHost.UseUrls($"http://0.0.0.0:{port}");

var app = builder.Build();

var api = app.MapGroup("/api");

api.MapGet("/hello", () => Results.Ok(new
{
    message = "Hello from C#",
    language = "csharp"
}));

api.MapGet("/status", () => Results.Ok(new
{
    status = "ok",
    service = "cs-webserver-test"
}));

app.Run();

static int GetPort()
{
    const int defaultPort = 10000;
    var configuredPort = Environment.GetEnvironmentVariable("PORT");

    return int.TryParse(configuredPort, out var port) && port is > 0 and <= 65535
        ? port
        : defaultPort;
}

// The application intentionally does not enable WebSockets yet. When that
// feature is needed, add the WebSocket middleware and a dedicated route here
// without changing the existing JSON API endpoints.
