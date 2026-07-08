FROM node:22-bookworm-slim AS web-build

WORKDIR /src

COPY web/package.json web/package-lock.json ./web/
RUN npm --prefix web ci

COPY web/ ./web/
RUN npm --prefix web run build

FROM golang:1.26.4-bookworm AS go-build

WORKDIR /src
ARG GOPROXY=https://goproxy.cn,direct
ENV GOPROXY=${GOPROXY}

COPY go.mod go.sum ./
RUN go mod download

COPY . .

RUN CGO_ENABLED=0 GOOS=linux go build -o /out/server ./cmd/server

FROM busybox:1.36.1-glibc AS runtime

WORKDIR /app

COPY --from=go-build /out/server ./server
COPY --from=go-build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=web-build /src/web/dist ./web/dist

RUN mkdir -p /app/data/uploads /app/data/private_uploads

EXPOSE 8080

CMD ["/app/server"]
