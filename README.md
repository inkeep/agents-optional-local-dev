# Inkeep Agents Docker Compose for Optional Local Dev

> [!WARNING]
> These Docker Compose configurations are **for local development and testing only**.  
> They are **not suitable for production use** and should not be deployed in live environments.

## Services Overview

This setup provides 4 main service profiles for local development with the Inkeep Agents Framework:

### 1. [Nango](https://github.com/NangoHQ/nango)
Inkeep Agents uses Nango to store credentials.
- **Nango Server**: `localhost:3050`
- **Nango Connect UI**: `localhost:3051`

### 2. [SigNoz](https://github.com/SigNoz/signoz)
SigNoz is the underlying service to view Spans and Traces in the Inkeep Manage UI.
- **SigNoz UI**: `localhost:3080`
- **OTLP gRPC**: `localhost:4317`
- **OTLP HTTP**: `localhost:4318`

### 3. [OTEL Collector](https://github.com/open-telemetry/opentelemetry-collector)
A standalone OpenTelemetry Collector, to manage outgoing can be sent to multiple destinations. The Inkeep Agents Run API will first send traces to the OTEL Collector, which then forwards traces to Signoz and Jaeger.
- **OTLP gRPC**: `localhost:14317`
- **OTLP HTTP**: `localhost:14318`

### 4. [Jaeger](https://github.com/jaegertracing/jaeger)
An optional misc tool to view traces from the Inkeep Agents Framework.
- **Jaeger UI**: `localhost:16686`
- **OTLP gRPC**: `localhost:24317`
- **OTLP HTTP**: `localhost:24318`