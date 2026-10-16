using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Text;

const int maxMessageBytes = 4096;
var clients = new ConcurrentDictionary<Guid, ClientConnection>();
var port = GetPort();

var builder = WebApplication.CreateBuilder(args);

// Render provides PORT at runtime. Binding to 0.0.0.0 makes the container
// reachable from outside itself; localhost-only binding would fail on Render.
builder.WebHost.UseUrls($"http://0.0.0.0:{port}");

var app = builder.Build();

app.UseWebSockets(new WebSocketOptions
{
    KeepAliveInterval = TimeSpan.FromMinutes(2)
});

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

app.Map("/ws", async context =>
{
    if (!context.WebSockets.IsWebSocketRequest)
    {
        context.Response.StatusCode = StatusCodes.Status400BadRequest;
        await context.Response.WriteAsJsonAsync(new
        {
            error = "WebSocket upgrade required."
        });
        return;
    }

    using var socket = await context.WebSockets.AcceptWebSocketAsync();
    var clientId = Guid.NewGuid();
    var client = new ClientConnection(socket);
    clients[clientId] = client;

    try
    {
        while (socket.State == WebSocketState.Open)
        {
            var message = await ReceiveTextMessageAsync(
                socket,
                maxMessageBytes,
                context.RequestAborted);

            if (message is null)
            {
                break;
            }

            await BroadcastAsync(clientId, message, clients);
        }
    }
    catch (OperationCanceledException) when (context.RequestAborted.IsCancellationRequested)
    {
        // The client disconnected or the request was cancelled.
    }
    catch (WebSocketException)
    {
        // The client disconnected without completing a normal close handshake.
    }
    finally
    {
        clients.TryRemove(clientId, out _);
        await client.CloseAsync();
    }
});

app.Run();

static int GetPort()
{
    const int defaultPort = 10000;
    var configuredPort = Environment.GetEnvironmentVariable("PORT");

    return int.TryParse(configuredPort, out var port) && port is > 0 and <= 65535
        ? port
        : defaultPort;
}

static async Task<string?> ReceiveTextMessageAsync(
    WebSocket socket,
    int maxMessageBytes,
    CancellationToken cancellationToken)
{
    var buffer = new byte[1024];
    using var message = new MemoryStream();

    while (true)
    {
        var result = await socket.ReceiveAsync(buffer, cancellationToken);

        if (result.MessageType == WebSocketMessageType.Close)
        {
            return null;
        }

        if (result.MessageType != WebSocketMessageType.Text)
        {
            await socket.CloseAsync(
                WebSocketCloseStatus.InvalidMessageType,
                "Text messages only.",
                CancellationToken.None);
            return null;
        }

        if (message.Length + result.Count > maxMessageBytes)
        {
            await socket.CloseAsync(
                WebSocketCloseStatus.MessageTooBig,
                "Messages are limited to 4096 bytes.",
                CancellationToken.None);
            return null;
        }

        message.Write(buffer, 0, result.Count);

        if (result.EndOfMessage)
        {
            return Encoding.UTF8.GetString(message.ToArray());
        }
    }
}

static async Task BroadcastAsync(
    Guid senderId,
    string message,
    ConcurrentDictionary<Guid, ClientConnection> clients)
{
    var payload = Encoding.UTF8.GetBytes(message);
    var sends = clients
        .Where(pair => pair.Key != senderId)
        .Select(async pair =>
        {
            try
            {
                await pair.Value.SendAsync(payload);
            }
            catch (WebSocketException)
            {
                clients.TryRemove(pair.Key, out _);
            }
            catch (ObjectDisposedException)
            {
                clients.TryRemove(pair.Key, out _);
            }
        });

    await Task.WhenAll(sends);
}

sealed class ClientConnection(WebSocket socket)
{
    private readonly SemaphoreSlim sendLock = new(1, 1);

    public async Task SendAsync(byte[] payload)
    {
        await sendLock.WaitAsync();
        try
        {
            if (socket.State == WebSocketState.Open)
            {
                await socket.SendAsync(
                    payload,
                    WebSocketMessageType.Text,
                    endOfMessage: true,
                    CancellationToken.None);
            }
        }
        finally
        {
            sendLock.Release();
        }
    }

    public async Task CloseAsync()
    {
        await sendLock.WaitAsync();
        try
        {
            if (socket.State is WebSocketState.Open or WebSocketState.CloseReceived)
            {
                await socket.CloseAsync(
                    WebSocketCloseStatus.NormalClosure,
                    "Connection closed.",
                    CancellationToken.None);
            }
        }
        catch (WebSocketException)
        {
            // The socket is already gone.
        }
        finally
        {
            sendLock.Release();
        }
    }
}
