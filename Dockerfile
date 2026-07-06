FROM node:22-bookworm-slim AS web-build

WORKDIR /src

COPY web/package.json web/package-lock.json ./web/
RUN npm --prefix web ci

COPY web/ ./web/
RUN npm --prefix web run build

FROM golang:1.26.4-bookworm AS go-build

WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY . .

RUN CGO_ENABLED=0 GOOS=linux go build -o /out/server ./cmd/server

FROM debian:bookworm-slim AS runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates wget \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=go-build /out/server ./server
COPY --from=web-build /src/web/dist ./web/dist

RUN mkdir -p /app/data/uploads /app/data/private_uploads

EXPOSE 8080

CMD ["/app/server"]
