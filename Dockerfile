FROM node:25-alpine

# Install build tools required to compile native node modules (e.g. better-sqlite3)
RUN apk add --no-cache python3 make g++ libc6-compat

# Install pnpm globally
RUN npm install -g pnpm@11.0.8

# Set working directory
WORKDIR /workspace

# Use node user
USER node
