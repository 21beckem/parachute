FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

COPY ["cs-webserver-test.csproj", "./"]
RUN dotnet restore "cs-webserver-test.csproj"

COPY . .
RUN dotnet publish "cs-webserver-test.csproj" \
    --configuration Release \
    --output /app/publish \
    /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS final
WORKDIR /app

# Render's default PORT is 10000. The application also reads PORT at runtime
# so the service continues to work if Render assigns a different value.
EXPOSE 10000

COPY --from=build /app/publish .
ENTRYPOINT ["dotnet", "cs-webserver-test.dll"]
